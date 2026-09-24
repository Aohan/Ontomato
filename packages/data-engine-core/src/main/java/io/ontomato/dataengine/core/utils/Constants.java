package io.ontomato.dataengine.core.utils;

/**
 * @author liuph
 */
public class Constants {

    private Constants() {

    }

    public static final String USER_KEY = "USER_KEY";

    /**
     * Date format: yyyy-MM-dd
     */
    public static final String SDF_YYYY_MM_DD = "yyyy-MM-dd";

    /**
     * RSA public key for the production-environment login request.
     * Outbound encryption uses this key alone.
     */
    public static final String ADMIN_PUBLIC_KEY = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCsOA/mrmUxn+DSC3mDclnCTQQXqbbsXJcopSXYjHR4U9BW14/CaKLkezS+AdNLPrtF135Jn4zVhSCzRcVYNruutqzpPZEdgGB4vJw16+LsOjGSG0Np7CLZg1YRP2vfCKYEtyrY5/jfts7DRbPf5FJljhO3w79xxo0dd0Sb1n1fEwIDAQAB";

    /**
     * Default path of the initialization SQL
     */
    public static final String INIT_SQL_DEFAULT_PATH = "db/init.sql";

}
