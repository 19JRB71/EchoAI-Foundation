import { describe, it, expect } from "vitest";
import {
  normalizeSpeech,
  parseWakeWord,
  isQuestion,
  matchLocalIntent,
  matchNavIntent,
  navConfirmation,
} from "./conversationHelpers.js";

describe("normalizeSpeech", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeSpeech("  Hey,  ECHO!!  ")).toBe("hey echo");
    expect(normalizeSpeech(null)).toBe("");
  });
});

describe("parseWakeWord", () => {
  it("detects the wake phrase and returns a trailing command", () => {
    const r = parseWakeWord("Hey Echo, what are my leads today?");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("what are my leads today");
  });

  it("matches with no trailing command", () => {
    const r = parseWakeWord("hey echo");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("");
  });

  it("tolerates common mishearings", () => {
    expect(parseWakeWord("hey eco").matched).toBe(true);
    expect(parseWakeWord("hay echo there").matched).toBe(true);
    expect(parseWakeWord("hi echo").matched).toBe(true);
  });

  it("does NOT trigger on a bare 'echo' without the leading hey", () => {
    expect(parseWakeWord("the echo of the room was loud").matched).toBe(false);
    expect(parseWakeWord("please echo that back").matched).toBe(false);
  });

  it("matches the phrase mid-utterance", () => {
    const r = parseWakeWord("okay so hey echo book me a meeting");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("book me a meeting");
  });
});

describe("isQuestion", () => {
  it("is true only when the reply ends with a question mark", () => {
    expect(isQuestion("What should we do next?")).toBe(true);
    expect(isQuestion("Here is your summary.")).toBe(false);
    expect(isQuestion("Ready when you are.  ")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("matchLocalIntent", () => {
  it("recognizes mute intents", () => {
    expect(matchLocalIntent("mute yourself")).toBe("mute");
    expect(matchLocalIntent("Echo, go quiet")).toBe("mute");
    expect(matchLocalIntent("stop listening please")).toBe("mute");
  });

  it("recognizes patience intents", () => {
    expect(matchLocalIntent("give me a minute")).toBe("patience");
    expect(matchLocalIntent("hold on")).toBe("patience");
    expect(matchLocalIntent("let me think")).toBe("patience");
    expect(matchLocalIntent("one sec")).toBe("patience");
  });

  it("returns null for ordinary commands", () => {
    expect(matchLocalIntent("what are my leads")).toBe(null);
    expect(matchLocalIntent("")).toBe(null);
  });
});

describe("matchNavIntent", () => {
  it("maps 'take me to <section>' commands to section ids", () => {
    expect(matchNavIntent("show me my leads")).toBe("leads");
    expect(matchNavIntent("go to leads")).toBe("leads");
    expect(matchNavIntent("show me the reputation page")).toBe("reputation");
    expect(matchNavIntent("go to settings")).toBe("settings");
    expect(matchNavIntent("show me the portfolio")).toBe("portfolio");
  });

  it("routes each department to its 'dept:<agent>' key (name or role alias)", () => {
    // Proper agent names.
    expect(matchNavIntent("go to atlas")).toBe("dept:atlas");
    expect(matchNavIntent("show me scout")).toBe("dept:scout");
    expect(matchNavIntent("go to nova")).toBe("dept:nova");
    expect(matchNavIntent("show me pulse")).toBe("dept:pulse");
    expect(matchNavIntent("open forge")).toBe("dept:forge");
    expect(matchNavIntent("go to sentinel")).toBe("dept:sentinel");
    // Role / department aliases (agent name not spoken).
    expect(matchNavIntent("marketing director")).toBe("dept:echo");
    expect(matchNavIntent("competitor report")).toBe("dept:scout");
    expect(matchNavIntent("advertising manager")).toBe("dept:atlas");
    expect(matchNavIntent("social media manager")).toBe("dept:nova");
    expect(matchNavIntent("go to crm")).toBe("dept:pulse");
    expect(matchNavIntent("receptionist")).toBe("dept:voice");
  });

  it("routes feature phrases to their own sections (not the owning department)", () => {
    // A section and its department are BOTH reachable by voice: the feature
    // phrase opens the section, the agent name/role opens the department.
    expect(matchNavIntent("show me campaigns")).toBe("campaigns");
    expect(matchNavIntent("show me social media")).toBe("social");
    expect(matchNavIntent("take me to the image studio")).toBe("image");
    expect(matchNavIntent("open video content")).toBe("video");
    expect(matchNavIntent("go to my sales scripts")).toBe("sales");
    expect(matchNavIntent("show me the content calendar")).toBe("contentcalendar");
  });

  it("covers the remaining sections so every section is voice-reachable", () => {
    expect(matchNavIntent("show me the overview")).toBe("overview");
    expect(matchNavIntent("go to my ai team")).toBe("aiteam");
    expect(matchNavIntent("open echo growth")).toBe("echogrowth");
    expect(matchNavIntent("take me to echo memory")).toBe("echomemory");
    expect(matchNavIntent("open voice settings")).toBe("voicesettings");
    expect(matchNavIntent("show me customer intelligence")).toBe("intelligence");
    expect(matchNavIntent("go to capital funding")).toBe("capitalfunding");
    expect(matchNavIntent("open customer feedback")).toBe("feedback");
    expect(matchNavIntent("show me the affiliate program")).toBe("affiliate");
    expect(matchNavIntent("go to the agency workspace")).toBe("agency");
    expect(matchNavIntent("open zapier")).toBe("zapier");
    expect(matchNavIntent("take me to the admin panel")).toBe("admin");
    expect(matchNavIntent("show me the health monitor")).toBe("sentinelhealth");
    expect(matchNavIntent("open call monitoring")).toBe("callmonitor");
    expect(matchNavIntent("go to the sales queue")).toBe("queueoverview");
    expect(matchNavIntent("show me email marketing")).toBe("email");
    expect(matchNavIntent("go to sms")).toBe("sms");
    expect(matchNavIntent("open follow ups")).toBe("followups");
    expect(matchNavIntent("take me to appointments")).toBe("appointments");
    expect(matchNavIntent("show me the chatbot")).toBe("chatbot");
    expect(matchNavIntent("go to phone agent")).toBe("phone");
    expect(matchNavIntent("open my roi dashboard")).toBe("roi");
    expect(matchNavIntent("show me the ad studio")).toBe("adstudio");
  });

  it("keeps multi-word sections from being swallowed by generic ones", () => {
    // "voice settings" must win over the "settings" section and the Voice dept.
    expect(matchNavIntent("open voice settings")).toBe("voicesettings");
    expect(matchNavIntent("go to settings")).toBe("settings");
    // "content calendar" must win over the "calendar"→appointments alias.
    expect(matchNavIntent("show me the content calendar")).toBe("contentcalendar");
    expect(matchNavIntent("take me to the calendar")).toBe("appointments");
    // "health monitor" must win over the bare "sentinel"→dept alias.
    expect(matchNavIntent("show me the health monitor")).toBe("sentinelhealth");
    expect(matchNavIntent("go to sentinel")).toBe("dept:sentinel");
  });

  it("sends 'mission control' / 'go home' to the home section", () => {
    expect(matchNavIntent("mission control")).toBe("missioncontrol");
    expect(matchNavIntent("go home")).toBe("missioncontrol");
    expect(matchNavIntent("take me home")).toBe("missioncontrol");
  });

  it("routes SEO/Google commands to the real 'googleseo' section id", () => {
    // Guards against key drift: the app section is "googleseo", not "seo".
    expect(matchNavIntent("take me to seo")).toBe("googleseo");
    expect(matchNavIntent("open google")).toBe("googleseo");
  });

  it("requires a verb for questionable targets and skips clear questions", () => {
    // Verb-required sections must fall through to Echo without a verb.
    expect(matchNavIntent("what are my leads today")).toBe(null);
    expect(matchNavIntent("how is my reputation")).toBe(null);
    // Even a standalone-capable target must not hijack a question.
    expect(matchNavIntent("how is my social media doing")).toBe(null);
    expect(matchNavIntent("what does the competitor report say")).toBe(null);
    expect(matchNavIntent("")).toBe(null);
  });

  it("does not fire on section words without a nav verb (protects Echo answers)", () => {
    // Sections require a verb, so a bare answer/utterance won't hijack Echo.
    expect(matchNavIntent("share this on social")).toBe(null);
    expect(matchNavIntent("yes launch the campaign")).toBe(null);
    expect(matchNavIntent("email the customer back")).toBe(null);
  });

  it("does not let generic department nouns hijack ordinary statements", () => {
    // These single nouns are department aliases only WITH a nav verb; a plain
    // conversational statement must fall through to Echo, not navigate.
    expect(matchNavIntent("competition is getting worse")).toBe(null);
    expect(matchNavIntent("our crm is behind")).toBe(null);
    expect(matchNavIntent("we need better oversight")).toBe(null);
    expect(matchNavIntent("advertising costs are up")).toBe(null);
    expect(matchNavIntent("i work from home")).toBe(null);
    expect(matchNavIntent("the queue is long today")).toBe(null);
    // ...but the same nouns DO navigate when paired with a nav verb.
    expect(matchNavIntent("go to crm")).toBe("dept:pulse");
    expect(matchNavIntent("take me to advertising")).toBe("dept:atlas");
    expect(matchNavIntent("show me the competition")).toBe("dept:scout");
  });
});

describe("navConfirmation", () => {
  it("speaks a section-specific confirmation that is never a question", () => {
    expect(navConfirmation("leads")).toBe("Opening your leads now.");
    expect(navConfirmation("portfolio")).toBe("Opening your portfolio now.");
    expect(navConfirmation("missioncontrol")).toBe(
      "Taking you back to Mission Control.",
    );
    expect(isQuestion(navConfirmation("leads"))).toBe(false);
  });

  it("names the department for 'dept:<agent>' keys", () => {
    expect(navConfirmation("dept:atlas")).toBe("Taking you to Atlas.");
    expect(navConfirmation("dept:nova")).toBe("Taking you to Nova.");
    expect(navConfirmation(null)).toBe("Here you go.");
  });
});
