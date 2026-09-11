import Link from "next/link"
import CannabisLeaf from "@/components/cannabis-leaf"

export default function Footer() {
  return (
    <footer className="border-t border-border py-8 px-4 sm:px-6 lg:px-8 pb-20 lg:pb-8">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CannabisLeaf className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground">TerpTalk</span>
          <span>— 21+ cannabis community</span>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          <Link href="/forum" className="hover:text-foreground transition-colors">Discussions</Link>
          <Link href="/diaries" className="hover:text-foreground transition-colors">Diaries</Link>
          <Link href="/strains" className="hover:text-foreground transition-colors">Strains</Link>
          <Link href="/deals" className="hover:text-foreground transition-colors">Deals</Link>
          <Link href="/guides" className="hover:text-foreground transition-colors">Guides</Link>
          <Link href="/help" className="hover:text-foreground transition-colors">Plant Help</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
        </div>
      </div>
    </footer>
  )
}
