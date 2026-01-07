import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { hkdf } from "@stablelib/hkdf";
import { SHA256 } from "@stablelib/sha256";

// Helper to encode/decode Base64
export const encodeBase64 = util.encodeBase64;
export const decodeBase64 = util.decodeBase64;

// 0. Derive Session Key (HKDF-SHA256) - Mandatory for Signal Protocol Compliance
// Derives a strong 32-byte session key from the raw Diffie-Hellman shared secret
export const deriveSessionKey = (sharedSecret, salt, info) => {
    // sharedSecret: Uint8Array (from X25519)
    // salt: Uint8Array or string (e.g., conversationId)
    // info: string (context, e.g., 'xevytalk-message-key')

    // Ensure inputs are Uint8Array
    const saltBytes = typeof salt === 'string' ? util.decodeUTF8(salt) : salt;
    const infoBytes = typeof info === 'string' ? util.decodeUTF8(info) : info;

    return hkdf(
        SHA256,
        sharedSecret,
        saltBytes,
        infoBytes,
        32 // 256-bit key length
    );
};

// 1. Generate Identity Key Pair (Ed25519) - For Signing & Identity Verification
// Returns { publicKey, secretKey } as Base64 strings
export const generateIdentityKeyPair = () => {
    const keys = nacl.sign.keyPair();
    return {
        publicKey: encodeBase64(keys.publicKey),
        secretKey: encodeBase64(keys.secretKey)
    };
};

// 2. Generate Encryption Key Pair (X25519/Curve25519) - For Message Encryption
// Returns { publicKey, secretKey } as Base64 strings
export const generateEncryptionKeyPair = () => {
    const keys = nacl.box.keyPair();
    return {
        publicKey: encodeBase64(keys.publicKey),
        secretKey: encodeBase64(keys.secretKey)
    };
};

// 3. Store Keys Securely (Local Storage wrapper for now)
// In a real E2EE app, we might use IndexedDB or Web Crypto API non-extractable keys if possible.
const KEY_STORAGE_PREFIX = 'xevytalk_e2ee_';

export const saveKeys = (userId, identityKeys, encryptionKeys) => {
    if (!userId) return;
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${userId}_identity`, JSON.stringify(identityKeys));
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${userId}_encryption`, JSON.stringify(encryptionKeys));
};

export const loadKeys = (userId) => {
    if (!userId) return null;
    const identity = localStorage.getItem(`${KEY_STORAGE_PREFIX}${userId}_identity`);
    const encryption = localStorage.getItem(`${KEY_STORAGE_PREFIX}${userId}_encryption`);

    if (!identity || !encryption) return null;

    return {
        identityKeys: JSON.parse(identity),
        encryptionKeys: JSON.parse(encryption)
    };
};


// 4. Sign a payload (e.g. your public encryption key) with your Identity Key
// Proves that "I own this encryption key"
export const signPayload = (payloadString, secretIdentityKeyB64) => {
    const secretKey = decodeBase64(secretIdentityKeyB64);
    const msg = util.decodeUTF8(payloadString);
    const signedMsg = nacl.sign(msg, secretKey);
    return encodeBase64(signedMsg);
};

// 5. Verify a signature
export const verifySignature = (signedPayloadB64, publicIdentityKeyB64) => {
    const signedMsg = decodeBase64(signedPayloadB64);
    const publicKey = decodeBase64(publicIdentityKeyB64);
    const verified = nacl.sign.open(signedMsg, publicKey);

    if (!verified) return null;
    return util.encodeUTF8(verified);
};

// 6. Encrypt Message (Box) - Authenticated Encryption (xsalsa20-poly1305)
// Uses sender's PRIVATE encryption key and receiver's PUBLIC encryption key
export const encryptMessage = (message, mySecretKeyB64, theirPublicKeyB64) => {
    const mySecret = decodeBase64(mySecretKeyB64);
    const theirPublic = decodeBase64(theirPublicKeyB64);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msgBytes = util.decodeUTF8(message);

    const encrypted = nacl.box(msgBytes, nonce, theirPublic, mySecret);

    const fullMessage = new Uint8Array(nonce.length + encrypted.length);
    fullMessage.set(nonce);
    fullMessage.set(encrypted, nonce.length);

    return encodeBase64(fullMessage);
};

// 7. Decrypt Message (Box)
export const decryptMessage = (encryptedMessageB64, mySecretKeyB64, theirPublicKeyB64) => {
    const messageWithNonce = decodeBase64(encryptedMessageB64);
    const mySecret = decodeBase64(mySecretKeyB64);
    const theirPublic = decodeBase64(theirPublicKeyB64);

    if (messageWithNonce.length < nacl.box.nonceLength) return null;

    const nonce = messageWithNonce.slice(0, nacl.box.nonceLength);
    const box = messageWithNonce.slice(nacl.box.nonceLength);

    const decrypted = nacl.box.open(box, nonce, theirPublic, mySecret);

    if (!decrypted) return null; // Decryption failed
    return util.encodeUTF8(decrypted);
};

// 8. Sign Signaling Payload (Step 2 - Harden WebRTC)
export const signSignalingPayload = (payloadObj, secretIdentityKeyB64) => {
    // payloadObj should contain peerId, nonce, timestamp, offer (as SDP string)
    const msg = util.decodeUTF8(JSON.stringify(payloadObj));
    const secretKey = decodeBase64(secretIdentityKeyB64);
    const signature = nacl.sign.detached(msg, secretKey);
    return encodeBase64(signature);
};

// 9. Verify Signaling Payload
export const verifySignalingPayload = (payloadObj, signatureB64, publicIdentityKeyB64) => {
    const msg = util.decodeUTF8(JSON.stringify(payloadObj));
    const signature = decodeBase64(signatureB64);
    const publicKey = decodeBase64(publicIdentityKeyB64);
    return nacl.sign.detached.verify(msg, signature, publicKey);
};

// 10. Generate Secure Nonce (96-bit / 12 bytes)
export const generateNonce = () => {
    return encodeBase64(nacl.randomBytes(12));
};
