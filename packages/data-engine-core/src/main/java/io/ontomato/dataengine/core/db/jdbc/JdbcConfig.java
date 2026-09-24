package io.ontomato.dataengine.core.db.jdbc;

import javax.sql.DataSource;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.PropertySource;

@Configuration
@EnableConfigurationProperties(JdbcProps.class)
@PropertySource("classpath:datarag-core.properties")
public class JdbcConfig {

    @Bean(destroyMethod = "close")
    HikariDataSource dataSource(JdbcProps props) {
        HikariDataSource ds = new HikariDataSource();
        ds.setDriverClassName(props.getDriverClassName());
        ds.setJdbcUrl(props.getUrl());
        ds.setUsername(props.getUsername());
        ds.setPassword(props.getPassword());
        return ds;
    }

    @Bean
    JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean("jdbcInitDb")
    InitDb initDb(JdbcProps props, JdbcTemplate jdbcTemplate, SuperAdminSeed superAdminSeed) {
        return new InitDb(props, jdbcTemplate, superAdminSeed);
    }

}
