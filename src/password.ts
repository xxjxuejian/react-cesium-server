import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const cost = 2 ** 15;
const blockSize = 8;
const parallelization = 3;
const keyLength = 64;

// 异步 scrypt 将耗时计算交给工作线程，后续登录请求仍能继续接收。
function derivePasswordKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: cost, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string) {
  // 每次生成新盐，同一密码用于不同账号时也不会产生相同的存储值。
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, storedCost, storedBlockSize, storedParallelization, salt, key, extra] =
    storedHash.split("$");

  // 当前只接受本项目生成的参数组合，避免异常记录触发任意计算量。
  if (
    algorithm !== "scrypt" ||
    storedCost !== String(cost) ||
    storedBlockSize !== String(blockSize) ||
    storedParallelization !== String(parallelization) ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(key ?? "") ||
    extra !== undefined
  ) {
    return false;
  }

  const candidateKey = await derivePasswordKey(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(candidateKey, Buffer.from(key, "hex"));
}
