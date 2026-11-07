import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

/** 备份和恢复都写入一个新文件，防止输错路径时覆盖现有数据库。 */
export async function copyDatabase(
  sourcePath: string,
  destinationPath: string,
) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error("源数据库和目标文件不能相同");
  // 只读打开：路径写错时直接失败，不能偷偷新建一个空的源数据库。
  const database = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  let ownsDestination = false;
  try {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (existsSync(destination + suffix)) {
        throw new Error("目标文件或其日志已经存在，请选择新的目标文件名");
      }
    }
    mkdirSync(dirname(destination), { recursive: true });
    // wx 保证文件存在时失败；600 限制支持 Unix 权限的系统上的文件访问。
    closeSync(openSync(destination, "wx", 0o600));
    ownsDestination = true;
    // SQLite 自己生成一致的快照，也能包含 WAL 中已提交的数据，不能用运行中的裸文件复制替代。
    await backup(database, destination);
    const copied = new DatabaseSync(destination, { readOnly: true });
    try {
      const integrity = copied.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") {
        throw new Error("备份文件完整性检查失败");
      }
      if (copied.prepare("PRAGMA foreign_key_check").all().length !== 0) {
        throw new Error("备份文件外键检查失败");
      }
    } finally {
      copied.close();
    }
    return destination;
  } catch (error) {
    // 只删除本次排他创建的失败产物，绝不删除用户原本已有的文件。
    if (ownsDestination && existsSync(destination)) unlinkSync(destination);
    throw error;
  } finally {
    database.close();
  }
}

/** 恢复使用新文件，并撤销备份中的会话，避免让备份之后已退出的令牌重新有效。 */
export async function restoreDatabase(
  sourcePath: string,
  destinationPath: string,
) {
  const destination = await copyDatabase(sourcePath, destinationPath);
  try {
    const database = new DatabaseSync(destination, {
      enableForeignKeyConstraints: true,
    });
    try {
      database.exec("DELETE FROM sessions");
    } finally {
      database.close();
    }
    return destination;
  } catch (error) {
    unlinkSync(destination);
    throw error;
  }
}
