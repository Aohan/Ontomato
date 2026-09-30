package io.ontomato.dataengine.core.db.jdbc;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@ConfigurationProperties(prefix = "ontomato.data-engine.jdbc")
public class JdbcProps {

    /** PostgreSQL connection URL, e.g. jdbc:postgresql://127.0.0.1:5432/datarag */
    String url;

    String username;

    String password;

    /** Default org.postgresql.Driver */
    String driverClassName = "org.postgresql.Driver";

    /** Initialization data directory (initdatas/*.json under classpath) */
    String initDataDir = "./initdatas";

    /** Check the super admin on every service start and initialize it if absent */
    boolean initAdmin = true;

}
