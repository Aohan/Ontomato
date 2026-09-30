package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/** The delete API's class, attribute and path are caller input: only a file recorded for this domain's object and attribute may go. */
class VectorResourceDaoDeleteTest {

	private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
	private final VectorResourceDao dao = new VectorResourceDao();
	/** A class name no real index uses, so every file below lives in directories this test creates. */
	private final String className = "/T" + UUID.randomUUID().toString().replace("-", "");
	private final String index = "vector-_" + className.substring(1) + "-photos-d1";
	/** Everything this test created, in creation order; removed in reverse, directories only when empty. */
	private final List<Path> created = new ArrayList<>();

	VectorResourceDaoDeleteTest() {
		ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbcTemplate);
	}

	@AfterEach
	void removeOnlyWhatThisTestCreated() throws IOException {
		for (int i = created.size() - 1; i >= 0; i--) {
			Path path = created.get(i);
			if (Files.isRegularFile(path)) {
				Files.delete(path);
			} else if (Files.isDirectory(path)) {
				try (var entries = Files.list(path)) {
					if (entries.findAny().isEmpty()) {
						Files.delete(path);
					}
				}
			}
		}
	}

	@Test
	void aRecordedFileIsDeleted() throws IOException {
		Path file = resource(index + "/a.png");
		when(jdbcTemplate.update(contains("\"" + index + "\""), eq("P1"), eq(index + "/a.png"))).thenReturn(1);

		dao.delete(className, "photos", "P1", index + "/a.png", "d1");

		assertFalse(Files.exists(file));
	}

	@Test
	void aFileNotRecordedForTheObjectIsKept() throws IOException {
		Path file = resource(index + "/a.png");
		when(jdbcTemplate.update(anyString(), eq("P1"), eq(index + "/a.png"))).thenReturn(0);

		assertThrows(IllegalArgumentException.class, () -> dao.delete(className, "photos", "P1", index + "/a.png", "d1"));
		assertTrue(Files.exists(file));
	}

	@Test
	void aPathOutsideTheIndexIsRejectedAndItsFileKept(@TempDir Path dir) throws IOException {
		Path victim = Files.writeString(dir.resolve("victim.txt"), "keep");
		String otherDomain = "vector-_" + className.substring(1) + "-photos-d2/a.png";
		Path otherDomainFile = resource(otherDomain);
		Path nested = resource(index + "/sub/a.png");

		for (String path : new String[] {victim.toString(), index + "/../../../" + victim, otherDomain, index + "/sub/a.png"}) {
			assertThrows(IllegalArgumentException.class, () -> dao.delete(className, "photos", "P1", path, "d1"), path);
		}

		assertTrue(Files.exists(victim));
		assertTrue(Files.exists(otherDomainFile));
		assertTrue(Files.exists(nested));
		verifyNoInteractions(jdbcTemplate);
	}

	@Test
	void anAttributeWithPathSegmentsCannotMoveTheIndexOutOfTheRoot() throws IOException {
		// attrName "p/sub" puts the index one level below the root; "p/../../../x" puts it outside the root.
		String nestedIndex = "vector-_" + className.substring(1) + "-p/sub-d1";
		Path nested = resource(nestedIndex + "/a.png");

		assertThrows(IllegalArgumentException.class, () -> dao.delete(className, "p/sub", "P1", nestedIndex + "/a.png", "d1"));
		assertThrows(IllegalArgumentException.class,
				() -> dao.delete(className, "p/../../../x", "P1", "vector-_" + className.substring(1) + "-p/../../../x-d1/a.png", "d1"));

		assertTrue(Files.exists(nested));
		verifyNoInteractions(jdbcTemplate);
	}

	@Test
	void illegalSuffixWithInputStreamIsRejectedWithoutCreatingFile() {
		io.ontomato.dataengine.bean.VectorResource res = new io.ontomato.dataengine.bean.VectorResource();
		res.setClassName(className);
		res.setAttrName("photos");
		res.setContent("some text");

		for (String badSuffix : new String[] {"../evil", "a*b", "", "toolongtoolong12345", null}) {
			java.io.ByteArrayInputStream is = new java.io.ByteArrayInputStream("data".getBytes());
			assertThrows(IllegalArgumentException.class, () -> dao.insert(res, is, badSuffix, "d1"));
		}

		Path indexDir = Paths.get("conf", "vectorResource", index);
		assertFalse(Files.exists(indexDir));
		verifyNoInteractions(jdbcTemplate);
	}

	@Test
	void emptyContentIsRejectedWithoutCreatingFile() {
		io.ontomato.dataengine.bean.VectorResource res = new io.ontomato.dataengine.bean.VectorResource();
		res.setClassName(className);
		res.setAttrName("photos");

		for (String emptyContent : new String[] {null, "", "   "}) {
			res.setContent(emptyContent);
			assertThrows(IllegalArgumentException.class, () -> dao.insert(res, null, null, "d1"));
		}

		Path indexDir = Paths.get("conf", "vectorResource", index);
		assertFalse(Files.exists(indexDir));
		verifyNoInteractions(jdbcTemplate);
	}

	@Test
	void clearRemovesDirectoryAndDropsTable() throws IOException {
		Path file = resource(index + "/a.png");
		assertTrue(Files.exists(file));

		dao.clear(className, "photos", "d1");

		assertFalse(Files.exists(file.getParent()));
		org.mockito.Mockito.verify(jdbcTemplate).execute("DROP TABLE IF EXISTS \"" + index + "\"");
	}

	@Test
	void clearByDomainRemovesDomainDirectoriesAndDropsTables() throws IOException {
		String domain1Index1 = "vector-_class1-photos-d1";
		String domain1Index2 = "vector-_class2-desc-d1";
		String domain2Index = "vector-_class3-photos-d2";

		Path file1 = resource(domain1Index1 + "/f1.png");
		Path file2 = resource(domain1Index2 + "/f2.png");
		Path otherDomainFile = resource(domain2Index + "/f3.png");

		when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("vector-%-d1")))
				.thenReturn(List.of(domain1Index1, domain1Index2));

		dao.clearByDomain("d1");

		assertFalse(Files.exists(file1.getParent()));
		assertFalse(Files.exists(file2.getParent()));
		assertTrue(Files.exists(otherDomainFile));
		org.mockito.Mockito.verify(jdbcTemplate).execute("DROP TABLE IF EXISTS \"" + domain1Index1 + "\"");
		org.mockito.Mockito.verify(jdbcTemplate).execute("DROP TABLE IF EXISTS \"" + domain1Index2 + "\"");
	}

	@Test
	void clearThrowsWhenDropTableFails() throws IOException {
		resource(index + "/a.png");
		org.mockito.Mockito.doThrow(new RuntimeException("DB drop failed"))
				.when(jdbcTemplate).execute("DROP TABLE IF EXISTS \"" + index + "\"");

		assertThrows(RuntimeException.class, () -> dao.clear(className, "photos", "d1"));
	}

	@Test
	void clearByDomainThrowsWhenQueryTablesFails() {
		when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("vector-%-d1")))
				.thenThrow(new RuntimeException("DB query failed"));

		assertThrows(RuntimeException.class, () -> dao.clearByDomain("d1"));
	}

	@Test
	void clearThrowsWhenFileDeleteFails() throws IOException {
		Path file = resource(index + "/a.png");
		File indexDir = file.getParent().toFile();
		indexDir.setWritable(false);
		try {
			assertThrows(IllegalStateException.class, () -> dao.clear(className, "photos", "d1"));
		} finally {
			indexDir.setWritable(true);
		}
	}

	@Test
	void deleteThrowsWhenFileDeleteFails() throws IOException {
		Path file = resource(index + "/a.png");
		File indexDir = file.getParent().toFile();
		when(jdbcTemplate.update(contains("\"" + index + "\""), eq("P1"), eq(index + "/a.png"))).thenReturn(1);
		indexDir.setWritable(false);
		try {
			assertThrows(IllegalStateException.class, () -> dao.delete(className, "photos", "P1", index + "/a.png", "d1"));
		} finally {
			indexDir.setWritable(true);
		}
	}

	/** Create a file under conf/vectorResource, recording every directory and file this creates. */
	private Path resource(String relative) throws IOException {
		Path file = Paths.get("conf", "vectorResource").resolve(relative).toAbsolutePath().normalize();
		List<Path> missing = new ArrayList<>();
		for (Path dir = file.getParent(); !Files.exists(dir); dir = dir.getParent()) {
			missing.add(0, dir);
		}
		for (Path dir : missing) {
			created.add(Files.createDirectory(dir));
		}
		created.add(Files.writeString(file, "x"));
		return file;
	}
}
