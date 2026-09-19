"use client"

import FeedbackTrigger from "@/components/feedback-modal"

// Footer "Feedback" — opens the shared feedback modal in place so the
// captured page path is wherever the member actually was.
export default function FooterFeedbackLink({ className }: { className?: string }) {
  return (
    <FeedbackTrigger className={className}>
      Feedback
    </FeedbackTrigger>
  )
}
