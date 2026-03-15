import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateEncryptionKey } from "../crypto.js";

describe("crypto", () => {
	const key = generateEncryptionKey();

	describe("encrypt/decrypt", () => {
		it("round-trips a simple string", () => {
			const plaintext = "xoxb-test-token-12345";
			const ciphertext = encrypt(plaintext, key);
			expect(ciphertext).not.toBe(plaintext);
			expect(decrypt(ciphertext, key)).toBe(plaintext);
		});

		it("round-trips empty string", () => {
			const ciphertext = encrypt("", key);
			expect(decrypt(ciphertext, key)).toBe("");
		});

		it("round-trips unicode content", () => {
			const plaintext = "Hello world! Clef de chiffrement";
			const ciphertext = encrypt(plaintext, key);
			expect(decrypt(ciphertext, key)).toBe(plaintext);
		});

		it("produces different ciphertexts for same plaintext (random IV)", () => {
			const plaintext = "same-input";
			const c1 = encrypt(plaintext, key);
			const c2 = encrypt(plaintext, key);
			expect(c1).not.toBe(c2);
			expect(decrypt(c1, key)).toBe(plaintext);
			expect(decrypt(c2, key)).toBe(plaintext);
		});

		it("fails to decrypt with wrong key", () => {
			const plaintext = "secret-data";
			const ciphertext = encrypt(plaintext, key);
			const wrongKey = generateEncryptionKey();
			expect(() => decrypt(ciphertext, wrongKey)).toThrow();
		});

		it("fails on tampered ciphertext", () => {
			const ciphertext = encrypt("test", key);
			const tampered = `${ciphertext.slice(0, -4)}AAAA`;
			expect(() => decrypt(tampered, key)).toThrow();
		});

		it("fails on too-short ciphertext", () => {
			expect(() => decrypt("dG9vc2hvcnQ=", key)).toThrow("too short");
		});
	});

	describe("generateEncryptionKey", () => {
		it("generates a 64-character hex string (32 bytes)", () => {
			const k = generateEncryptionKey();
			expect(k).toHaveLength(64);
			expect(/^[0-9a-f]{64}$/.test(k)).toBe(true);
		});

		it("generates unique keys", () => {
			const k1 = generateEncryptionKey();
			const k2 = generateEncryptionKey();
			expect(k1).not.toBe(k2);
		});
	});

	describe("key validation", () => {
		it("throws on invalid key length", () => {
			expect(() => encrypt("test", "tooshort")).toThrow("64-character hex");
		});
	});
});
