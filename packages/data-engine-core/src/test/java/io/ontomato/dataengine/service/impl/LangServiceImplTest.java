package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The open-source edition installs only the English pack: any other or no requested language reads it,
 * a pack without a key falls back to English, and an unknown key yields the key itself.
 */
class LangServiceImplTest {

    private static final Path LANG = Path.of("conf-defaults/lang");

    @TempDir
    Path temp;

    @Test
    void theEnglishOnlyPackAnswersEveryRequestedLanguage() throws Exception {
        Files.createDirectories(temp.resolve("lang"));
        try (Stream<Path> files = Files.list(LANG)) {
            for (Path file : files.toList()) {
                Files.copy(file, temp.resolve("lang").resolve(file.getFileName()));
            }
        }
        BiFunction<String, String, String> lang = langService(temp);
        Map<String, String> english = pack(LANG.resolve("en.json"));
        for (String requested : Arrays.asList(null, "en", "zh-CN", "unknown")) {
            english.forEach((key, value) -> assertEquals(value, lang.apply(requested, key), requested + " " + key));
            assertEquals("No.such.key", lang.apply(requested, "No.such.key"));
        }
    }

    @Test
    void aPackWithoutTheKeyFallsBackToEnglish() throws Exception {
        Files.createDirectories(temp.resolve("lang"));
        Files.copy(LANG.resolve("en.json"), temp.resolve("lang/en.json"));
        Map<String, String> english = pack(LANG.resolve("en.json"));
        String[] keys = english.keySet().toArray(String[]::new);
        Files.writeString(temp.resolve("lang/xx.json"), "[{\"key\":\"" + keys[0] + "\",\"value\":\"xx value\"}]");
        BiFunction<String, String, String> lang = langService(temp);
        assertEquals("xx value", lang.apply("xx", keys[0]));
        assertEquals(english.get(keys[1]), lang.apply("xx", keys[1]));
        assertEquals("No.such.key", lang.apply("xx", "No.such.key"));
    }

    static Map<String, String> pack(Path file) throws Exception {
        Map<String, String> values = new LinkedHashMap<>();
        for (Object entry : JSONArray.parseArray(Files.readString(file))) {
            JSONObject object = (JSONObject) entry;
            values.put(object.getString("key"), object.getString("value"));
        }
        return values;
    }

    /**
     * The production service over one conf directory holding only lang/: loaded in its own class loader
     * whose classpath starts with that directory, as the conf directory does in the app.
     */
    static BiFunction<String, String, String> langService(Path conf) throws Exception {
        List<URL> urls = new ArrayList<>(List.of(conf.toAbsolutePath().toUri().toURL()));
        for (String entry : System.getProperty("java.class.path").split(File.pathSeparator)) {
            urls.add(Path.of(entry).toAbsolutePath().toUri().toURL());
        }
        URLClassLoader loader = new URLClassLoader(urls.toArray(URL[]::new), ClassLoader.getPlatformClassLoader());
        Thread thread = Thread.currentThread();
        ClassLoader previous = thread.getContextClassLoader();
        thread.setContextClassLoader(loader);
        try {
            Class<?> type = loader.loadClass(LangServiceImpl.class.getName());
            Object service = type.getConstructor().newInstance();
            type.getMethod("initService").invoke(service);
            Method get = type.getMethod("get", String.class, String.class);
            return (lang, key) -> {
                try {
                    return (String) get.invoke(service, lang, key);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException(e);
                }
            };
        } finally {
            thread.setContextClassLoader(previous);
        }
    }
}
