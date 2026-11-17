const recordName = "multia:v1:chats";
const saltName = "multia:v1:salt";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes) {
  return bytes.toBase64();
}

function decode(text) {
  return Uint8Array.fromBase64(text);
}

function exclusive(operation) {
  return navigator.locks.request(recordName, operation);
}

async function deriveKey(password) {
  const salt = await exclusive(() => {
    const saved = localStorage.getItem(saltName);
    if (saved) return decode(saved);
    const created = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(saltName, encode(created));
    return created;
  });
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function load(key) {
  const saved = localStorage.getItem(recordName);
  if (!saved) return null;
  const { iv, ciphertext } = JSON.parse(saved);
  const buffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv) }, key, decode(ciphertext));
  return JSON.parse(decoder.decode(buffer));
}

async function save(key, database) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    encoder.encode(JSON.stringify(database)));
  localStorage.setItem(recordName, JSON.stringify({ iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) }));
}

export async function openVault(password, initialize) {
  const key = await deriveKey(password);
  const database = await exclusive(async () => {
    const saved = await load(key);
    if (saved) return saved;
    const created = initialize();
    await save(key, created);
    return created;
  });
  return { key, database };
}

export async function changeVault(key, change) {
  return exclusive(async () => {
    const database = await load(key);
    if (!database) throw new Error("The browser’s chat storage was cleared.");
    change(database);
    database.revision += 1;
    await save(key, database);
    return database;
  });
}
