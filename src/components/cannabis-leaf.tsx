// TerpTalk brand mark — uses your own image from /public/logo.png
// Drop your artwork at public/logo.png (square works best) and it will
// appear in the nav, hero, and footer automatically.
export default function CannabisLeaf({ className = "w-6 h-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt="TerpTalk" className={`${className} object-contain`} />
  )
}
