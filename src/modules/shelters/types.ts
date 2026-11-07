/** 场所位置，采用 WGS84 经纬度，接口中以 location 对象传输。 */
export interface ShelterLocation {
  /** 经度，-180～180 度，必须为有限数值。 */
  longitude: number;
  /** 纬度，-90～90 度，必须为有限数值。 */
  latitude: number;
  /** 高度，单位米；省略或输入 null 时数据库保存 NULL，响应省略。 */
  height?: number;
}

/** 新增或完整更新的资料白名单，不含服务器维护字段。 */
export interface ShelterValues {
  /** 场所名称，去除首尾空格后为 1～100 个字符，允许同名。 */
  name: string;
  /** school 学校、stadium 体育馆、park 公园、communityCenter 社区中心、undergroundSpace 地下空间、other 其他。 */
  facilityType: string;
  /** temporary 临时、longTerm 长期、medicalAid 医疗、supplyDistribution 物资、comprehensive 综合。 */
  shelterUsage: string;
  /** open 开放、full 满员、maintenance 维护、closed 停用。 */
  operationStatus: string;
  /** 总容量，非负安全整数，单位人。 */
  capacity: number;
  /** 可用容量，非负安全整数，不大于总容量，单位人。 */
  availableCapacity: number;
  /** 设施编码数组，可为空，不能重复；具体允许值由 service 的固定列表限定。 */
  facilities: string[];
  /** 地址，1～500 个字符。 */
  address: string;
  /** 场所坐标，至少包含经纬度。 */
  location: ShelterLocation;
  /** 管理单位，1～100 个字符。 */
  managementUnit: string;
  /** 联系人，1～64 个字符。 */
  contactName: string;
  /** 联系电话，1 开头的 11 位手机号。 */
  contactPhone: string;
  /** 备注，最多 2000 个字符；省略、null 或空白表示清空，响应省略。 */
  description?: string;
}

/** 数据库读取后组装的完整场所资料，列表与详情均沿用前端契约。 */
export interface ShelterRecord extends ShelterValues {
  /** 服务器生成且不能修改的编号。 */
  id: string;
  /** 创建时间，北京时间 YYYY-MM-DD HH:mm:ss，更新时保留。 */
  createdAt: string;
  /** 最近更新时间，北京时间 YYYY-MM-DD HH:mm:ss。 */
  updatedAt: string;
}
