/** 单层圆柱状防御范围，单位均为米，高度相对统一地面零平面。 */
export interface DefenseRing {
  /** 水平半径，大于零的有限数值。 */
  radius: number;
  /** 高度下界，有限数值且大于等于零。 */
  minHeight: number;
  /** 高度上界，有限数值且严格大于下界。 */
  maxHeight: number;
}

/** 固定三层，共用单位的经纬度中心，外层空间包含内层。 */
export interface DefenseRings {
  /** 最内层核心圈。 */
  core: DefenseRing;
  /** 包含核心圈的反制圈，半径必须更大。 */
  counter: DefenseRing;
  /** 包含反制圈的最外层警戒圈，半径必须更大。 */
  warning: DefenseRing;
}

/** 新增或完整更新使用的白名单资料。 */
export interface KeyUnitValues {
  /** 去除首尾空格后为 1～100 个字符，允许同名。 */
  name: string;
  /** WGS84 共同中心经度，单位度，范围 -180～180。 */
  longitude: number;
  /** WGS84 共同中心纬度，单位度，范围 -90～90。 */
  latitude: number;
  /** 位置描述，最多 500 个字符，未填写时提交空字符串。 */
  address: string;
  /** 备注，最多 2000 个字符，未填写时提交空字符串。 */
  remark: string;
  /** 恰好三个完整圈层，整体更新，不自动修正其他层。 */
  rings: DefenseRings;
}

/** 列表范围摘要，不读取备注和创建时间。 */
export interface KeyUnitListItem {
  /** 服务器生成的唯一编号。 */
  id: string;
  /** 展示与筛选使用的单位名称。 */
  name: string;
  /** 共同中心经度，单位度。 */
  longitude: number;
  /** 共同中心纬度，单位度。 */
  latitude: number;
  /** 位置描述，可以为空字符串。 */
  address: string;
  /** 三层范围，供列表展示半径与上下高度。 */
  rings: DefenseRings;
  /** 最近更新时间，北京时间 YYYY-MM-DD HH:mm:ss。 */
  updatedAt: string;
}

/** 详情及新增、更新响应使用的完整记录。 */
export interface KeyUnitRecord extends KeyUnitListItem {
  /** 补充说明，未填写时为空字符串。 */
  remark: string;
  /** 首次创建时间，北京时间 YYYY-MM-DD HH:mm:ss，更新时保留。 */
  createdAt: string;
}
