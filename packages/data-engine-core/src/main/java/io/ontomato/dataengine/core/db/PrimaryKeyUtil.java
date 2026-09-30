package io.ontomato.dataengine.core.db;

import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicLong;

import cn.hutool.core.util.IdUtil;

/**
 * ID utility
 *
 * @author felix
 * @date 2023/04/07
 */
public class PrimaryKeyUtil {
    /**
     * Get a {@link Long} ID
     *
     * @return long
     */
    public static long nextId() {
        return IdGenerator.createGenerator().getNextId();
    }

    /**
     * Get an Object ID, suitable for scenarios where characters are used as the primary key
     *
     * @return {@link String}
     */
    public static String nextObjectId() {
//        return ObjIdGenerator.createGenerator().generate().toString();
        return String.valueOf(IdGenerator.createGenerator().getNextId());
    }

    /**
     * Get an obfuscated ID, suitable for special scenarios; for example a user ID, where the generated ID is random
     * <p>
     * todo This method is not efficient; unless you have requirements like the above, do not use this method to generate IDs
     *
     * @return {@link String}
     */
    @SuppressWarnings("StringBufferReplaceableByString")
    public synchronized static String nextConfuseId() {
        char[] uuidChar = IdUtil.fastSimpleUUID().toCharArray();
        return new StringBuilder(32).append(uuidChar, 0, 8).append(nextId()).append(uuidChar, 24, 8).toString();
    }

    /**
     * ID generator
     */
    static class IdGenerator {

        private final AtomicLong baseId;

        private static volatile IdGenerator idGenerator = null;

        public static IdGenerator createGenerator() {
            if (null == idGenerator) {
                synchronized (IdGenerator.class) {
                    if (null == idGenerator) {
                        idGenerator = new IdGenerator();
                    }
                }
            }
            return idGenerator;
        }

        /**
         * ID generator
         */
        private IdGenerator() {
            long t = System.currentTimeMillis();
            // 53~45
            long initBaseId = t;
            initBaseId &= 0x1FF0000000L;
            initBaseId <<= 16;
            // 30~17
            t &= 0xFFFC000L;
            t <<= 2;
            initBaseId |= t;
            // 44~31
            SecureRandom ng = new SecureRandom();
            t = ng.nextLong();
            t &= 0x3FFF0000000L;
            t <<= 2;
            initBaseId |= t;
            // 16~1
            initBaseId /= 50000;
            initBaseId *= 50000;
            initBaseId &= 0x1FFFFFFFFFFFFFL;
            baseId = new AtomicLong(initBaseId);
        }

        /**
         * Get ID
         *
         * @return long
         */
        public long getNextId() {
            return baseId.getAndIncrement();
        }
    }

//    /**
//     * Object ID generator
//     *
//     * @author felix
//     * @date 2023/05/12
//     */
//    static class ObjIdGenerator {
//        private static volatile ObjectIdGenerator objIdGenerator = null;
//
//        public static ObjectIdGenerator createGenerator() {
//            if (null == objIdGenerator) {
//                synchronized (ObjIdGenerator.class) {
//                    if (null == objIdGenerator) {
//                        objIdGenerator = new ObjectIdGenerator();
//                    }
//                }
//            }
//            return objIdGenerator;
//        }
//    }
}
