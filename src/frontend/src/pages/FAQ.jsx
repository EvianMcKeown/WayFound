import Page from "../components/Page";
import { Panel } from "../components/ui";

const FAQS = [
    {
        question: "How do I plan a journey?",
        answer:
            "Enter your starting point and destination in the search fields, pick a day and time, and choose any route preferences (optional). The planner will find the best route for you.",
    },
    {
        question: "Can I save routes so that I can view them again?",
        answer:
            "Yes. After finding a route, choose “Save this route”. You will be asked to sign in if you haven’t. Your routes then appear under Saved routes in the header, where you can rename them or plan them again in one click.",
    },
    {
        question: "Can the planner remember that I prefer less walking?",
        answer:
            "Yes. Signed-in users can set journey preferences in Settings. The planner starts with them switched on, and you can still change them for a single search under Options.",
    },
    {
        question: "A time or stop looks wrong. What should I do?",
        answer:
            "Choose “Report an issue” under a journey result (it attaches that journey for us), or use the link at the bottom of this page.",
    },
    {
        question: "Can I use the planner on my phone?",
        answer: "Yes, the website is fully mobile-friendly.",
    },
];

export default function FAQ() {
    return (
        <Page width="lg">
            <h1 className="text-xl font-semibold tracking-tight">Help and FAQs</h1>

            <Panel as="section" aria-labelledby="video-heading" className="p-4">
                <h2 id="video-heading" className="mb-3 text-sm font-semibold text-mist-700">Watch the help video</h2>
                <video
                    controls
                    preload="metadata"
                    poster="/help-video-poster.jpg"
                    className="aspect-video w-full rounded-lg bg-mist-100"
                    aria-label="Journey plan walkthrough"
                >
                    <source src="/help-video.mp4" type="video/mp4" />
                    <track kind="captions" src="/help-video.vtt" srcLang="en" label="English" />
                </video>
            </Panel>

            <Panel as="section" aria-labelledby="faq-heading" className="p-4">
                <h2 id="faq-heading" className="mb-2 text-sm font-semibold text-mist-700">Frequently asked questions</h2>
                <div className="divide-y divide-mist-200/80">
                    {FAQS.map((faq) => (
                        <details key={faq.question} className="group py-3">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-mist-900">
                                {faq.question}
                                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-mist-600 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </summary>
                            <p className="mt-2 text-sm text-mist-700">{faq.answer}</p>
                        </details>
                    ))}
                </div>
            </Panel>
        </Page>
    );
}
