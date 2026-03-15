import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKeyBuffer(key: string): Buffer {
	const buf = Buffer.from(key, "hex");
	if (buf.length !== 32) {
		throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
	}
	return buf;
}

export function encrypt(plaintext: string, key: string): string {
	const keyBuf = getKeyBuffer(key);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });

	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	// Format: base64(iv + authTag + ciphertext)
	const combined = Buffer.concat([iv, authTag, encrypted]);
	return combined.toString("base64");
}

export function decrypt(ciphertext: string, key: string): string {
	const keyBuf = getKeyBuffer(key);
	const combined = Buffer.from(ciphertext, "base64");

	if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error("Invalid ciphertext: too short");
	}

	const iv = combined.subarray(0, IV_LENGTH);
	const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

	const decipher = createDecipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	return decrypted.toString("utf8");
}

export function generateEncryptionKey(): string {
	return randomBytes(32).toString("hex");
}
