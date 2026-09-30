// lucide-react ships no per-icon .d.ts files — icons.ts imports the deep
// ESM modules directly, so declare them here. Every icon file's default
// export is a LucideIcon component.
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "@/lib/icons"
  const Icon: LucideIcon
  export default Icon
}
