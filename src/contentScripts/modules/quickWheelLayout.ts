/**
 * 轮盘的几何 —— **8 个固定槽位，每 45° 一个**，与参考图一致：
 * 顶部 0° → 右上 45° → 右 90° → 右下 135° → 底部 180° → 左下 225° → 左 270° → 左上 315°。
 *
 * 结构照参考图来：**一个大的中心圆 + 八片彼此分开的「花瓣」**。
 *   - 中心圆半径 WHEEL_HUB（≈ 外径的 0.44，参考图就是这个比例，太小吃不住文字）；
 *   - 花瓣从 WHEEL_PETAL_IN 起、到 WHEEL_OUTER 止，与中心圆之间留一圈空隙；
 *   - 花瓣彼此之间留 WHEEL_GAP×2 的角缝隙，缝隙里透出的是虚化后的页面，不是又一层底色 ——
 *     「一格一格分开」是靠**留白**做出来的，不是靠画线。
 *
 * 为什么固定 8 个、而不是按项目数均分：需求要求「最上方是首页、最下方是动态」，
 * 这两条同时成立的前提是方向数为**偶数**（只有等分点里同时存在 0° 与 180°）。
 * 按 7 项均分（51.43°）时正下方根本没有槽位，动态只能歪在 154.3°。
 * 固定 8 个之后，槽位是「位置」而不是「列表项」：卸下只会把槽清空，位置本身不会消失。
 *
 * 坐标约定：SVG 里画在 440×440 的 viewBox 上，圆心 (220,220)；
 * 角度 0° = 正上方，顺时针为正。
 */

export const WHEEL_SLOTS = 8
export const WHEEL_SIZE = 440
export const WHEEL_CENTER = 220
export const WHEEL_OUTER = 210
/** 中心圆半径：外径的 0.44（参考图比例）。名字 + 提示两行要装得下 */
export const WHEEL_HUB = 92
/** 花瓣起始半径：与中心圆之间留 12 的空隙 */
export const WHEEL_PETAL_IN = 104


/** 图标圆心到轮盘中心的半径（花瓣带 104~210 的中线略偏外） */
export const WHEEL_CHIP_R = 152

/** 每个槽位的张角 */
export const WHEEL_SPAN = 360 / WHEEL_SLOTS
/** 花瓣单侧让出的角度（总缝隙 4.4°，外缘处约 16px）—— 缝隙要看得见「这是两片」，
 *  但也不能太宽：缝隙里是虚化后的页面，越宽越像「辐条」而不是「花瓣之间的空」 */
export const WHEEL_GAP = 2.2




/** 第 i 个槽位的中心角度（0 = 正上方，顺时针） */
export function slotAngle(i: number) {
  return i * WHEEL_SPAN
}

/** 极坐标 → SVG 坐标。deg 以正上方为 0、顺时针为正 */
export function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [WHEEL_CENTER + r * Math.cos(a), WHEEL_CENTER + r * Math.sin(a)]
}

/**
 * 一片「花瓣」的 path（外弧 → 内弧）。
 *
 * 两侧各让出 WHEEL_GAP 度：相邻两片之间自然露出一道缝，透出虚化后的页面。
 * 这比画分隔线更像参考图 —— 参考图里那八块本来就是断开的，不是被线切开的。
 */
export function sectorPath(i: number): string {
  const a0 = slotAngle(i) - WHEEL_SPAN / 2 + WHEEL_GAP
  const a1 = slotAngle(i) + WHEEL_SPAN / 2 - WHEEL_GAP
  const [x0, y0] = polar(WHEEL_OUTER, a0)
  const [x1, y1] = polar(WHEEL_OUTER, a1)
  const [x2, y2] = polar(WHEEL_PETAL_IN, a1)
  const [x3, y3] = polar(WHEEL_PETAL_IN, a0)
  return [
    `M${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A${WHEEL_OUTER} ${WHEEL_OUTER} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A${WHEEL_PETAL_IN} ${WHEEL_PETAL_IN} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    'Z',
  ].join(' ')
}



/** 图标相对轮盘中心的偏移，单位是「轮盘直径的百分比」—— 轮盘缩放时图标跟着走 */
export function chipOffset(i: number): { x: number, y: number } {
  const a = ((slotAngle(i) - 90) * Math.PI) / 180
  const k = (WHEEL_CHIP_R / WHEEL_SIZE) * 100
  return { x: Math.cos(a) * k, y: Math.sin(a) * k }
}

/**
 * 指针位置 → 槽位序号；落在中心圆里返回 -1。
 *
 * dx / dy 是指针相对轮盘中心的**像素**偏移；hubRadius 是中心圆在屏幕上的像素半径
 * （轮盘按 min(440px, 74vmin) 渲染，所以由调用方换算后传进来）。
 * 指针在中心圆里时方向没有意义，这时候不替用户选任何东西。
 */
export function indexFromPoint(dx: number, dy: number, hubRadius: number): number {
  const dist = Math.hypot(dx, dy)
  if (dist < hubRadius) return -1
  // atan2 的 0 在右方、逆时针为正 → 换成「正上方为 0、顺时针为正」
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360
  // 8 等分：取最近的槽位中心，边界处不跳变
  return Math.round(deg / WHEEL_SPAN) % WHEEL_SLOTS
}
