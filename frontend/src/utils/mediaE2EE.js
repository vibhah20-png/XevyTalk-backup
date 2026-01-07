import nacl from 'tweetnacl';

// Helper to encrypt a media frame
// Uses XSalsa20-Poly1305 (via nacl.secretbox)
export function encryptFrame(data, key) {
    if (!key) return data; // If no key, pass through? Or fail? User code implies key exists.

    // Generate random nonce (24 bytes for xsalsa20)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

    // Data is usually an ArrayBuffer or view. tweetnacl wants Uint8Array.
    const message = new Uint8Array(data);

    // Encrypt
    const encrypted = nacl.secretbox(message, nonce, key);

    // Prepend nonce to the encrypted payload
    const out = new Uint8Array(nonce.length + encrypted.length);
    out.set(nonce);
    out.set(encrypted, nonce.length);

    return out.buffer; // Return ArrayBuffer for WebRTC frame.data
}

// Helper to decrypt a media frame
export function decryptFrame(data, key) {
    if (!key) return data;

    const input = new Uint8Array(data);

    if (input.length < nacl.secretbox.nonceLength) return data; // Data too short

    // Extract nonce
    const nonce = input.slice(0, nacl.secretbox.nonceLength);
    const box = input.slice(nacl.secretbox.nonceLength);

    // Decrypt
    const decrypted = nacl.secretbox.open(box, nonce, key);

    if (!decrypted) {
        // console.error('Frame decryption failed'); 
        // Failing silently or returning garbage might be safer for streams than crashing
        // But throwing might be better debugging. 
        // For now, return empty or throw?
        // WebRTC TransformStreams often swallow errors or stop stream.
        // Let's return original data? No, that's noise. Return empty buffer?
        return new Uint8Array(0).buffer;
    }

    return decrypted.buffer;
}
