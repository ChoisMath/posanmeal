import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNotoSansKR } from "@remotion/google-fonts/NotoSansKR";

const inter = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});
const noto = loadNotoSansKR("normal", {
  weights: ["400", "500", "700"],
  subsets: ["korean", "latin"],
  ignoreTooManyRequestsWarning: true,
});

export const FONT = `${inter.fontFamily}, ${noto.fontFamily}, "Apple SD Gothic Neo", sans-serif`;
export const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;
