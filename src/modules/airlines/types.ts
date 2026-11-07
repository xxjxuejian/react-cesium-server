/** 服务端校验并重新编号的航点；数组顺序即飞行顺序。 */
export interface AirlineWaypoint {
  /** WGS84 经度，单位度，-180～180 的有限数值。 */
  longitude: number;
  /** WGS84 纬度，单位度，-90～90 的有限数值。 */
  latitude: number;
  /** 相对统一地面零平面的高度，单位米，有限数值且不小于零。 */
  altitude: number;
  /** 后端按数组顺序生成的序号，从 1 开始，不接受客户端覆盖。 */
  order: number;
}

/** 完整保存航线所需的资料，所有字段均由原始请求经白名单校验产生。 */
export interface AirlineValues {
  /** 去除首尾空格的航线名称，1～100 个字符，允许同名。 */
  name: string;
  /** 统一飞行速度，单位米/秒，必须为大于零的有限数值。 */
  speed: number;
  /** 备注，最多 2000 个字符；请求中省略时保存为空字符串，保留输入空格。 */
  remark: string;
  /** 2～1000 个完整航点；更新时整体替换。 */
  waypoints: AirlineWaypoint[];
}

/** 航线列表只返回摘要，避免分页查询传输完整航点。 */
export interface AirlineListItem {
  /** 服务器生成的唯一编号。 */
  id: string;
  /** 航线名称。 */
  name: string;
  /** 后端根据航点数组计算的数量。 */
  waypointCount: number;
  /** 相邻航点水平大圆距离之和，单位米，不计高度差且不自动闭合。 */
  length: number;
  /** 统一速度，单位米/秒。 */
  speed: number;
  /** 更新时间，北京时间 YYYY-MM-DD HH:mm:ss。 */
  updatedAt: string;
}

/** 查看、编辑和保存响应使用的完整航线。 */
export interface AirlineRecord extends AirlineListItem {
  /** 备注，未填写时为空字符串。 */
  remark: string;
  /** 首次创建时间，北京时间 YYYY-MM-DD HH:mm:ss，更新时保留。 */
  createdAt: string;
  /** 全部航点，包含后端重新生成的序号。 */
  waypoints: AirlineWaypoint[];
}
