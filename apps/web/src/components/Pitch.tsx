const TWITTER_URL = "https://x.com/degenSumi";
const LINKEDIN_URL = "https://www.linkedin.com/in/sumit-singh-bisht";

export function Pitch() {
  return (
    <div className="rounded-lg border border-brand/20 bg-brand/[0.06] px-3 py-2.5">
      <p className="text-[11px] font-medium text-brand-soft">
        Want agents like this for your business?
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted">
        Support, inventory, enquiries — custom designed, built and shipped end to end for your
        workflows. Runs on your data, inside your business. You own all of it. No leaks.
      </p>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="mr-0.5 text-[10px] font-medium text-muted">Contact us</span>
        <a
          href={TWITTER_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-brand/25 px-2 py-1 text-[10px] font-medium text-brand-soft transition-colors hover:bg-brand/15"
        >
          X
        </a>
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-brand/25 px-2 py-1 text-[10px] font-medium text-brand-soft transition-colors hover:bg-brand/15"
        >
          LinkedIn
        </a>
      </div>
    </div>
  );
}
