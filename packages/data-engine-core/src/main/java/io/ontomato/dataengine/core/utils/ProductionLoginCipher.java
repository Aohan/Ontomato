package io.ontomato.dataengine.core.utils;

import io.ontomato.dataengine.core.exception.ServiceException;

import cn.hutool.core.util.CharsetUtil;
import cn.hutool.crypto.asymmetric.KeyType;
import cn.hutool.crypto.asymmetric.RSA;

/**
 * Public-key encryption for the production-environment login request.
 * The private key is not available here; a null private key must not be sent through a helper that substitutes a default key pair.
 */
public final class ProductionLoginCipher {

    private ProductionLoginCipher() {
    }

    public static String encrypt(String source) {
        try {
            RSA rsa = new RSA(null, Constants.ADMIN_PUBLIC_KEY);
            return rsa.encryptBase64(source, CharsetUtil.CHARSET_UTF_8, KeyType.PublicKey);
        } catch (Exception e) {
            throw new ServiceException("Invalid username or password!");
        }
    }
}
