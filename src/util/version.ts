// 版本号归一与比较。踩过的坑：
// - GitHub tag 有的带 v 有的不带（v1.8.0 / 2.46.0）
// - Homebrew 已装版本带修订号（cocoapods 1.16.2_2），上游 tag 没有

/** 去掉前导 v / V 和首尾空白 */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^[vV](?=\d)/, '');
}

/** 去掉 Homebrew 修订号后缀（_N），用于和上游 tag 对齐 */
export function stripBrewRevision(v: string): string {
  return v.replace(/_\d+$/, '');
}

/** 从任意文本里取第一个 x.y.z（允许预发布后缀），取不到返回 undefined */
export function extractVersion(text: string): string | undefined {
  const m = text.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return m?.[0];
}

export function sameVersion(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

/**
 * 粗略比较两个版本：按 . - _ 分段，数字段按数值比，其余按字符串比。
 * 返回 <0 / 0 / >0。仅用于排序 release 列表，不作为「是否落后」的唯一依据
 * （是否落后以包管理器自己的判断或 latest 不等于 installed 为准）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.\-_+]/);
  const pb = normalizeVersion(b).split(/[.\-_+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
