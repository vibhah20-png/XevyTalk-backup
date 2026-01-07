// Strong Cryptographic Stack using TweetNaCl (NaCl port)
// Implements X25519 (ECDH), Ed25519 (Signing), and XSalsa20-Poly1305 (Encryption)

import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'

// Helper to encode/decode
// We use TextEncoder/TextDecoder for string <-> Uint8Array conversion as it's standard and robust
const { encodeBase64, decodeBase64 } = naclUtil

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

function encodeUTF8(str) {
    return utf8Encoder.encode(str)
}

function decodeUTF8(arr) {
    return utf8Decoder.decode(arr)
}

/**
 * Generate a long-term Identity Key Pair (Ed25519)
 * Used for signing messages and proving identity.
 */
export function generateIdentityKeyPair() {
    return nacl.sign.keyPair()
}

/**
 * Generate an Encryption Key Pair (X25519)
 * Used for Diffie-Hellman Key Exchange.
 */
export function generateEncryptionKeyPair() {
    return nacl.box.keyPair()
}

/**
 * Encode key pair to Base64 strings for storage
 */
export function exportKeyPair(keyPair) {
    return {
        publicKey: encodeBase64(keyPair.publicKey),
        secretKey: encodeBase64(keyPair.secretKey)
    }
}

/**
 * Decode key pair from Base64 strings
 */
export function importKeyPair(exportedKeys) {
    return {
        publicKey: decodeBase64(exportedKeys.publicKey),
        secretKey: decodeBase64(exportedKeys.secretKey)
    }
}

/**
 * Convert an Ed25519 Public Key to X25519 Public Key
 * (Useful if we want to use the same Identity key for encryption - simpler Signal flow)
 * Note: TweetNaCl doesn't have a direct helper for this, so we usually keep them separate.
 * We will maintain separate Identity (Sign) and PreKey (Box) pairs.
 */

/**
 * Encrypt a message using Public Key Authenticated Encryption (Box)
 * Simplest E2EE: Sender's Secret Key + Recipient's Public Key -> Shared Secret -> Encrypt
 * 
 * @param {string} message - Plain text
 * @param {Uint8Array} recipientPublicKey - The other user's public encryption key
 * @param {Uint8Array} mySecretKey - My private encryption key
 */
export function encryptMessage(message, recipientPublicKey, mySecretKey) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const messageUint8 = encodeUTF8(message)

    // Encrypts (Auth + Enc)
    const box = nacl.box(messageUint8, nonce, recipientPublicKey, mySecretKey)

    // Return packed 'nonce:ciphertext'
    return encodeBase64(nonce) + ':' + encodeBase64(box)
}

/**
 * Decrypt a message
 * 
 * @param {string} encryptedBundle - 'nonce:ciphertext'
 * @param {Uint8Array} senderPublicKey - Sender's public encryption key
 * @param {Uint8Array} mySecretKey - My private encryption key
 */
export function decryptMessage(encryptedBundle, senderPublicKey, mySecretKey) {
    try {
        const [nonceB64, boxB64] = encryptedBundle.split(':')
        if (!nonceB64 || !boxB64) throw new Error('Invalid format')

        const nonce = decodeBase64(nonceB64)
        const box = decodeBase64(boxB64)

        const decrypted = nacl.box.open(box, nonce, senderPublicKey, mySecretKey)

        if (!decrypted) {
            throw new Error('Decryption failed - verification failed')
        }

        return decodeUTF8(decrypted)
    } catch (e) {
        // console.error('Decryption error:', e)
        return null
    }
}

/**
 * Check if message is in encrypted format
 */
export function isEncrypted(msg) {
    return typeof msg === 'string' && msg.includes(':') && msg.split(':').length === 2
}

// Key Management Helpers
export const STORAGE_KEY = 'xevytalk_e2ee_keys'

export function getStoredKeys() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
}

export function storeKeys(keys) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
}

export function getOrGenerateKeys() {
    let keys = getStoredKeys()
    if (!keys) {
        console.log('Generating new E2EE Identity & Encryption Keys...')
        const identity = generateIdentityKeyPair()
        const encryption = generateEncryptionKeyPair()

        keys = {
            identity: exportKeyPair(identity),
            encryption: exportKeyPair(encryption)
        }
        storeKeys(keys)
    }
    return keys
}

// Convert stored base64 key to Uint8Array for usage
export function loadKey(base64Key) {
    return decodeBase64(base64Key)
}
