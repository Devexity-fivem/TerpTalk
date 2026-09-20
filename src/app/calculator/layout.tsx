import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Grow Cost Calculator",
  description: "Estimate the electricity cost of running your grow setup — lights, fans, pumps, and more.",
}

export default function CalculatorLayout({ children }: { children: React.ReactNode }) {
  return children
}
