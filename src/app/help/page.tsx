import ProblemWizard from "@/components/problem-wizard"
import { Stethoscope } from "lucide-react"

export const metadata = {
  title: "Plant Problem Solver",
  description: "Interactive diagnostic tool — answer a few questions about your plant's symptoms and get likely causes and fixes.",
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <Stethoscope className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold mb-2">What&apos;s wrong with my plant?</h1>
          <p className="text-muted-foreground">Answer a few questions and we&apos;ll point you at the most likely cause — and how to fix it.</p>
        </div>
        <ProblemWizard />
      </div>
    </div>
  )
}
