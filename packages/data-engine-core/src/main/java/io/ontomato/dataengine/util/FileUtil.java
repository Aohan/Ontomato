package io.ontomato.dataengine.util;

import java.io.*;
import java.util.ArrayList;
import java.util.List;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class FileUtil {
	/**
	 * List the file names in a resource directory on the classpath (non-recursive).
	 * The same addressing scheme as {@link #getResourceFileLoadAll}: the "find" and "read" of product resources have only one locating method,
	 * and do not depend on the process working directory. In the container it hits the directory with the same name under /deploy/conf, and on the local machine it hits conf-defaults.
	 */
	public static List<String> listResourceNames(String dirName) {
		try {
			Resource[] resources = new PathMatchingResourcePatternResolver()
					.getResources("classpath:" + dirName + "/*");
			List<String> names = new ArrayList<>(resources.length);
			for (Resource resource : resources) {
				String name = resource.getFilename();
				if (name != null) {
					names.add(name);
				}
			}
			return names;
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to list the classpath resource directory: " + dirName, e);
		}
	}

	public static String getResourceFileLoadAll(String fileName, String charset) {
        BufferedReader reader = null;
        InputStreamReader isr = null;
        InputStream is = null;
        try {
            is = FileUtil.class.getClassLoader().getResourceAsStream(fileName);
//            isr =  new InputStreamReader(is);
//            reader = new BufferedReader(isr);

            byte[] buf = is.readAllBytes();
            String content = new String(buf, charset);
            return content;
        } catch (IOException e) {
            return null;
        } finally {
            try {
                if (is != null) {
                    is.close();
                }
            } catch (IOException e) {
            }
        }
    }

    public static String getFileLoadAll(String fileName, String charset) {

        FileInputStream is = null;
        try {
            File file = new File(fileName);
            is = new FileInputStream(file);
            byte[] buf = is.readAllBytes();
            String content = new String(buf, charset);
            return content;
        } catch (IOException e) {
            return null;
        } finally {
            try {
                if (is != null) {
                    is.close();
                }
            } catch (IOException e) {
            }
        }
    }
    
    public static void writeFile(String fileName, String content, String charset) {
    	FileOutputStream fos = null;
    	try {
    		fos = new FileOutputStream(fileName);
    		fos.write(content.getBytes(charset));
            fos.flush();
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    	} finally {
    		if (fos != null) {
    			try {
    				fos.close();
    			} catch (Exception e) {
    				log.error(e.getMessage(), e);
    			}
    		}
    	}
    }
}
