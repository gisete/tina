// npx tsx src/lib/api/token.fixture.ts
import { extractBearer, hashToken, isApiScope, verifyApiToken, type TokenRecord } from "./token";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

const plaintext = "tina_example-token-value";
const rec = (over: Partial<TokenRecord> = {}): TokenRecord => ({
  id: "t1", userId: "u1", tokenHash: hashToken(plaintext), scopes: ["read"], revokedAtMs: null, ...over,
});
const bearer = `Bearer ${plaintext}`;

// Hash: known SHA-256 of "abc", lowercase hex, 64 chars.
assert(hashToken("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 vector");
assert(hashToken(plaintext) !== plaintext, "hash is not the plaintext");

// Bearer parsing.
assert(extractBearer(bearer) === plaintext, "bearer parsed");
assert(extractBearer("bearer   " + plaintext) === plaintext, "case-insensitive scheme");
assert(extractBearer(null) === null && extractBearer("") === null, "absent header");
assert(extractBearer("Basic abc") === null, "wrong scheme");
assert(extractBearer("Bearer a b") === null, "extra tokens rejected");

// Verdicts.
const ok = verifyApiToken({ authorization: bearer, record: rec(), requiredScope: "read" });
assert(ok.ok && ok.userId === "u1" && ok.tokenId === "t1", "valid token accepted");
assert(!verifyApiToken({ authorization: null, record: rec(), requiredScope: "read" }).ok, "no header rejected");
const miss = verifyApiToken({ authorization: null, record: rec(), requiredScope: "read" });
assert(!miss.ok && miss.reason === "missing", "missing reason");
const none = verifyApiToken({ authorization: bearer, record: null, requiredScope: "read" });
assert(!none.ok && none.reason === "invalid", "no record → invalid");
const wrong = verifyApiToken({ authorization: "Bearer tina_other", record: rec(), requiredScope: "read" });
assert(!wrong.ok && wrong.reason === "invalid", "hash mismatch → invalid even with a record");
const rev = verifyApiToken({ authorization: bearer, record: rec({ revokedAtMs: 1 }), requiredScope: "read" });
assert(!rev.ok && rev.reason === "revoked", "revoked rejected");
const scope = verifyApiToken({ authorization: bearer, record: rec(), requiredScope: "sync" });
assert(!scope.ok && scope.reason === "insufficient_scope", "read token cannot sync");
assert(verifyApiToken({ authorization: bearer, record: rec({ scopes: ["read", "sync"] }), requiredScope: "sync" }).ok, "read+sync token can sync");
// Invalid beats revoked: a mismatching hash on a revoked record is still "invalid".
const inv2 = verifyApiToken({ authorization: "Bearer tina_other", record: rec({ revokedAtMs: 1 }), requiredScope: "read" });
assert(!inv2.ok && inv2.reason === "invalid", "invalid reported before revoked");
// Revoked beats scope; invalid beats revoked.
const both = verifyApiToken({ authorization: bearer, record: rec({ revokedAtMs: 1, scopes: [] }), requiredScope: "sync" });
assert(!both.ok && both.reason === "revoked", "revoked reported before scope");

assert(isApiScope("read") && isApiScope("sync") && !isApiScope("admin"), "scope guard");
console.log("token fixture: all assertions passed");
