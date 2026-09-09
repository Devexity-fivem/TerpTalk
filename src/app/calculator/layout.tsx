import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Grow Light Cost Calculator",
  description: "Estimate the electricity cost of running your grow lights.",
}

export default function CalculatorLayout({ children }: { children: React.ReactNode }) {
  return children
}
