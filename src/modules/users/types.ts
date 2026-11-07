/** 用户资料写入白名单；编号、时间和密码通过独立流程维护。 */
export interface UserValues {
  /** 登录名，去除首尾空格后为 1～64 个字符，数据库内唯一。 */
  username: string;
  /** 展示昵称，1～64 个字符。 */
  nickname: string;
  /** enabled 允许登录，disabled 禁止登录并撤销会话。 */
  status: "enabled" | "disabled";
  /** male 男，female 女，unknown 未知。 */
  gender: "male" | "female" | "unknown";
  /** 部门普通文本，最多 100 个字符，省略时为空字符串。 */
  department: string;
  /** admin 管理员，viewer 普通用户。 */
  role: "admin" | "viewer";
  /** 可选的 11 位手机号，省略时为空字符串。 */
  phone: string;
  /** 可选邮箱，最多 254 个字符，省略时为空字符串。 */
  email: string;
}
