import { describe, it, expect } from "vitest";
import {
  withTimeout,
  normalizeSpeech,
  parseWakeWord,
  isQuestion,
  isSelfEcho,
  selfEchoRemainder,
  parseWakeGreetingOnly,
  matchLocalIntent,
  matchNavIntent,
  navConfirmation,
  navOfferQuestion,
  navLabel,
  matchYesNo,
  matchTransferIntent,
  matchBrandSwitch,
  matchClearNotifications,
  matchContentCreateIntent,
  matchContentReviewCommand,
  matchAutopilotReviewIntent,
  matchAutopilotSetupIntent,
  speakableAutopilotItem,
  speakableDraft,
  BRIEF_SECTIONS,
} from "./conversationHelpers.js";

describe("normalizeSpeech", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeSpeech("  Hey,  ECHO!!  ")).toBe("hey echo");
    expect(normalizeSpeech(null)).toBe("");
  });
});

describe("isSelfEcho", () => {
  const question = "You have three hot leads waiting. Want me to read them out?";

  it("flags Echo's own trailing audio (exact tail phrase) as self-echo", () => {
    expect(isSelfEcho("want me to read them out", [question])).toBe(true);
    expect(isSelfEcho("read them out", [question])).toBe(true);
  });

  it("flags a slightly-misheard longer leak via fuzzy tail overlap", () => {
    // 5 of 6 words appear in the tail (>= 70%).
    expect(isSelfEcho("want me to reed them out", [question])).toBe(true);
  });

  it("lets a quick real answer through — the whole point of the fix", () => {
    expect(isSelfEcho("yes", [question])).toBe(false);
    expect(isSelfEcho("no", [question])).toBe(false);
    expect(isSelfEcho("yes please", [question])).toBe(false);
    expect(isSelfEcho("go ahead sir", [question])).toBe(false);
  });

  it("only matches against the TAIL, so a short answer word from earlier in Echo's sentence is safe", () => {
    // "no" appears early in Echo's line but not in the last 12 words —
    // a spoken "no" right after must be treated as the owner's answer.
    const line =
      "There are no new leads today. Would you like me to walk you through the campaign numbers instead?";
    expect(isSelfEcho("no", [line])).toBe(false);
  });

  it("treats empty/noise captures as echo (drop)", () => {
    expect(isSelfEcho("", [question])).toBe(true);
    expect(isSelfEcho("   ", [question])).toBe(true);
  });

  it("passes real speech when there is nothing recent to compare against", () => {
    expect(isSelfEcho("open my leads", [])).toBe(false);
    expect(isSelfEcho("open my leads", null)).toBe(false);
  });

  it("flags a long leak of the MIDDLE of Echo's sentence (late-finalized capture)", () => {
    const line =
      "One more thing: your social media accounts setup isn't finished yet — the next step is to connect at least one social account.";
    // The recognizer finalized a capture of the middle of the line, not the tail.
    expect(
      isSelfEcho("your social media accounts setup isn't finished yet", [line]),
    ).toBe(true);
    expect(
      isSelfEcho("one more thing your social media accounts setup", [line]),
    ).toBe(true);
  });

  it("lets a real 5+ word command through even when it reuses a few of Echo's words", () => {
    expect(
      isSelfEcho("read me my hot leads please", [question]),
    ).toBe(false);
    expect(
      isSelfEcho("open the social media section now", [
        "Your social media accounts setup isn't finished yet.",
      ]),
    ).toBe(false);
  });

  it("checks every recent line, not just the newest", () => {
    const older = "Shall I schedule that post for tomorrow morning?";
    expect(
      isSelfEcho("schedule that post for tomorrow morning", [older, question]),
    ).toBe(true);
  });
});

describe("selfEchoRemainder", () => {
  const question = "I've opened Scout's department. Want me to give you the rundown?";

  it("salvages a real answer glued onto the end of Echo's leaked audio", () => {
    expect(
      selfEchoRemainder(
        "s department want me to give you the rundown yes",
        [question],
      ),
    ).toBe("yes");
    expect(
      selfEchoRemainder(
        "want me to give you the rundown yes please",
        [question],
      ),
    ).toBe("yes please");
  });

  it("returns empty for a pure self-echo chunk", () => {
    expect(selfEchoRemainder("want me to give you the rundown", [question])).toBe("");
    expect(selfEchoRemainder("", [question])).toBe("");
  });

  it("treats an oversized (5+ word) remainder as noise, not speech", () => {
    expect(
      selfEchoRemainder(
        "rundown please pull up every single hot new lead",
        [question],
      ),
    ).toBe("");
  });

  it("fails closed on a misheard trailing token that is not a real answer", () => {
    // A pure leak with one ASR-hallucinated trailing word must stay dropped —
    // "blue" is not an unambiguous short answer.
    expect(
      selfEchoRemainder("want me to give you the rundown blue", [question]),
    ).toBe("");
  });

  it("accepts 'sir'-suffixed short answers", () => {
    expect(
      selfEchoRemainder("want me to give you the rundown yes sir", [question]),
    ).toBe("yes sir");
  });
});

describe("parseWakeGreetingOnly", () => {
  it("accepts a greeting-led command when the recognizer dropped 'Echo'", () => {
    // Exact utterance from the live diagnostic report.
    const r = parseWakeGreetingOnly("hey give me the phone number");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("give me the phone number");
  });

  it("tolerates greeting mishearings and a comma", () => {
    expect(parseWakeGreetingOnly("hay, open my leads").matched).toBe(true);
    expect(parseWakeGreetingOnly("heya show the dashboard").command).toBe(
      "show the dashboard",
    );
  });

  it("rejects a bare greeting with no command", () => {
    expect(parseWakeGreetingOnly("hey").matched).toBe(false);
    expect(parseWakeGreetingOnly("hey there").matched).toBe(false);
  });

  it("rejects a mid-sentence 'hey' and non-greeting speech", () => {
    expect(parseWakeGreetingOnly("I said hey to the contractor").matched).toBe(
      false,
    );
    expect(parseWakeGreetingOnly("give me the phone number").matched).toBe(
      false,
    );
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

  it("tolerates recognizer mishearings of 'echo'", () => {
    expect(parseWakeWord("hey ecko").matched).toBe(true);
    expect(parseWakeWord("hey ekko").matched).toBe(true);
    expect(parseWakeWord("hey ecco").matched).toBe(true);
    expect(parseWakeWord("hey eko").matched).toBe(true);
    expect(parseWakeWord("hey echoes").matched).toBe(true);
    expect(parseWakeWord("hey echos").matched).toBe(true);
    expect(parseWakeWord("hey gecko").matched).toBe(true);
    expect(parseWakeWord("hey echo ai").matched).toBe(true);
    expect(parseWakeWord("hey echoai").matched).toBe(true);
    expect(parseWakeWord("hey a co").matched).toBe(true);
  });

  it("tolerates mishearings of the greeting and a missing space", () => {
    expect(parseWakeWord("hei echo").matched).toBe(true);
    expect(parseWakeWord("heya echo").matched).toBe(true);
    expect(parseWakeWord("hey there echo").matched).toBe(true);
    expect(parseWakeWord("heyecho").matched).toBe(true);
    expect(parseWakeWord("Hey, Echo — show my leads").matched).toBe(true);
  });

  it("still extracts the command after a misheard wake phrase", () => {
    const r = parseWakeWord("hey ecko show me my leads");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("show me my leads");
  });

  it("does NOT trigger on a bare 'echo' without the leading hey", () => {
    expect(parseWakeWord("the echo of the room was loud").matched).toBe(false);
    expect(parseWakeWord("please echo that back").matched).toBe(false);
    expect(parseWakeWord("echo show me my leads").matched).toBe(false);
    expect(parseWakeWord("there was an echo in the call").matched).toBe(false);
  });

  it("does NOT trigger on similar but unrelated phrases", () => {
    expect(parseWakeWord("hey everyone").matched).toBe(false);
    expect(parseWakeWord("hey how are you").matched).toBe(false);
    expect(parseWakeWord("hey elle").matched).toBe(false);
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
  it("handles every required hands-free navigation command", () => {
    // The exact command set that must work (wake phrase stripped upstream).
    expect(matchNavIntent("go to facebook setup")).toBe("action:facebook");
    expect(matchNavIntent("connect facebook")).toBe("action:facebook");
    expect(matchNavIntent("go to atlas")).toBe("dept:atlas");
    expect(matchNavIntent("show me campaigns")).toBe("campaigns");
    expect(matchNavIntent("go to settings")).toBe("settings");
    expect(matchNavIntent("take me home")).toBe("missioncontrol");
    expect(matchNavIntent("show me my leads")).toBe("leads");
    expect(matchNavIntent("go to sage")).toBe("dept:sage");
    expect(matchNavIntent("show me scout")).toBe("dept:scout");
  });

  it("routes Facebook phrasings to the connect wizard action", () => {
    expect(matchNavIntent("facebook setup")).toBe("action:facebook");
    expect(matchNavIntent("set up facebook")).toBe("action:facebook");
    expect(matchNavIntent("connect my facebook")).toBe("action:facebook");
    expect(matchNavIntent("link facebook")).toBe("action:facebook");
    expect(matchNavIntent("go to facebook")).toBe("action:facebook");
    // Bare "facebook" in a statement/question must NOT hijack navigation.
    expect(matchNavIntent("facebook is expensive")).toBe(null);
    expect(matchNavIntent("how is facebook doing")).toBe(null);
  });

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

  it("routes bare agent names 'voice' and 'sage' to their departments", () => {
    // Regression: "go to Voice" and "go to Sage" previously returned null —
    // the Voice dept regex lacked the bare word and Sage had no target at all.
    expect(matchNavIntent("go to voice")).toBe("dept:voice");
    expect(matchNavIntent("take me to voice")).toBe("dept:voice");
    expect(matchNavIntent("go to sage")).toBe("dept:sage");
    expect(matchNavIntent("show me sage")).toBe("dept:sage");
    expect(matchNavIntent("open the industry brief")).toBe("dept:sage");
    // Bare "voice" needs a nav verb so casual mentions don't hijack navigation.
    expect(matchNavIntent("i like the voice feature")).toBe(null);
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

describe("navConfirmation (varied)", () => {
  it("speaks a section-aware confirmation that is never a question", () => {
    for (let i = 0; i < 10; i++) {
      const line = navConfirmation("leads");
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
      expect(isQuestion(line)).toBe(false);
      // Every variant either names the section or is a generic acknowledgment.
      expect(/your leads|taking you there|on it sir/i.test(line)).toBe(true);
    }
  });

  it("names the department (or acknowledges) for 'dept:<agent>' keys", () => {
    for (let i = 0; i < 10; i++) {
      const line = navConfirmation("dept:atlas");
      expect(/atlas|on it sir/i.test(line)).toBe(true);
      expect(isQuestion(line)).toBe(false);
    }
    expect(typeof navConfirmation(null)).toBe("string");
  });

  it("never repeats the same confirmation twice in a row", () => {
    let prev = navConfirmation("leads");
    for (let i = 0; i < 25; i++) {
      const next = navConfirmation("leads");
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

describe("navOfferQuestion", () => {
  it("asks before reading — every offer is a question", () => {
    expect(isQuestion(navOfferQuestion("leads"))).toBe(true);
    expect(isQuestion(navOfferQuestion("campaigns"))).toBe(true);
    expect(isQuestion(navOfferQuestion("dept:sage"))).toBe(true);
    expect(isQuestion(navOfferQuestion("missioncontrol"))).toBe(true);
    expect(isQuestion(navOfferQuestion("roi"))).toBe(true);
  });

  it("special-cases Sage's report and names generic departments", () => {
    for (let i = 0; i < 10; i++) {
      expect(/sage/i.test(navOfferQuestion("dept:sage"))).toBe(true);
      expect(/nova/i.test(navOfferQuestion("dept:nova"))).toBe(true);
    }
  });

  it("rotates offers without repeating the same one twice in a row", () => {
    let prev = navOfferQuestion("leads");
    for (let i = 0; i < 25; i++) {
      const next = navOfferQuestion("leads");
      expect(next).not.toBe(prev);
      expect(isQuestion(next)).toBe(true);
      prev = next;
    }
  });

  it("returns null for pure actions (no read offer)", () => {
    expect(navOfferQuestion("action:facebook")).toBe(null);
    expect(navOfferQuestion(null)).toBe(null);
  });
});

describe("BRIEF_SECTIONS", () => {
  it("maps data-backed nav keys to server brief sections", () => {
    expect(BRIEF_SECTIONS.leads).toBe("leads");
    expect(BRIEF_SECTIONS.campaigns).toBe("campaigns");
    expect(BRIEF_SECTIONS["dept:atlas"]).toBe("campaigns");
    expect(BRIEF_SECTIONS["dept:sage"]).toBe("sage");
    expect(BRIEF_SECTIONS.settings).toBe(undefined);
  });
});

describe("navLabel", () => {
  it("gives a human label for sections and departments", () => {
    expect(navLabel("leads")).toBe("your leads");
    expect(navLabel("dept:sage")).toBe("Sage's department");
    expect(navLabel("missioncontrol")).toBe("Mission Control");
    expect(navLabel("nonsense")).toBe("this section");
  });
});

describe("matchYesNo", () => {
  it("recognizes natural affirmations", () => {
    for (const t of [
      "yes",
      "yes please",
      "sure",
      "yeah go ahead",
      "okay",
      "read it to me",
      "absolutely",
      "let's hear it",
      "go for it",
    ]) {
      expect(matchYesNo(t)).toBe("yes");
    }
  });

  it("recognizes natural declines", () => {
    for (const t of [
      "no",
      "no thanks",
      "nah",
      "not right now",
      "maybe later",
      "I'm good",
      "never mind",
      "no that's okay",
    ]) {
      expect(matchYesNo(t)).toBe("no");
    }
  });

  it("returns null for anything else so it's treated as a new command", () => {
    expect(matchYesNo("take me to my campaigns")).toBe(null);
    expect(matchYesNo("what's my ad spend")).toBe(null);
    expect(matchYesNo("")).toBe(null);
    expect(matchYesNo("play some music")).toBe(null);
  });

  it("a bare polite 'please <command>' is NOT an affirmation", () => {
    expect(matchYesNo("please open my settings")).toBe(null);
    expect(matchYesNo("please")).toBe(null);
    // ...but explicit yes-phrases with please still count.
    expect(matchYesNo("yes please")).toBe("yes");
    expect(matchYesNo("please do")).toBe("yes");
  });
});

describe("matchTransferIntent (live hot-lead handoff)", () => {
  it("recognizes 'transfer' answers as a handoff", () => {
    for (const t of [
      "transfer it",
      "transfer them to me",
      "transfer the call",
      "take it over",
      "take over",
      "hand it to me",
      "put them through",
      "connect me",
      "I'll take it",
    ]) {
      expect(matchTransferIntent(t)).toBe("transfer");
    }
  });

  it("recognizes 'keep handling' answers as continue", () => {
    for (const t of [
      "keep handling it",
      "keep going",
      "you handle it",
      "you got it",
      "handle it",
      "carry on",
      "stay on it",
    ]) {
      expect(matchTransferIntent(t)).toBe("continue");
    }
  });

  it("leans a bare yes to transfer and a bare no to continue", () => {
    expect(matchTransferIntent("yes")).toBe("transfer");
    expect(matchTransferIntent("no")).toBe("continue");
    expect(matchTransferIntent("no thanks")).toBe("continue");
  });

  it("returns null for unrelated speech so it's treated as a new command", () => {
    expect(matchTransferIntent("take me to my campaigns")).toBe(null);
    expect(matchTransferIntent("what's my ad spend")).toBe(null);
    expect(matchTransferIntent("")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Interrupt commands (barge-in while Echo speaks)
// ---------------------------------------------------------------------------
import {
  withTimeout,
  matchInterruptIntent,
  matchBriefingIntent,
  matchBriefingChoice,
  BRIEFING_CHOICE_QUESTION,
} from "./conversationHelpers.js";

describe("matchInterruptIntent", () => {
  it("matches short standalone interrupt commands", () => {
    for (const t of [
      "Stop",
      "stop",
      "Cancel",
      "Never mind",
      "nevermind",
      "Wait",
      "That's enough",
      "that is enough",
      "okay stop",
      "stop talking",
      "echo stop",
      "hey echo stop",
      "stop please",
    ]) {
      expect(matchInterruptIntent(t)).toBe(true);
    }
  });

  it("never matches sentences that merely contain an interrupt word (Echo's own speech)", () => {
    for (const t of [
      "you should stop by the leads section for a look",
      "we can't wait to see how the campaign performs this week",
      "that's enough budget to run three more ad sets this month",
      "your campaign will stop on Friday",
      "",
    ]) {
      expect(matchInterruptIntent(t)).toBe(false);
    }
  });
});

describe("matchBriefingIntent", () => {
  it("recognizes on-demand briefing requests", () => {
    for (const t of [
      "give me my briefing",
      "brief me",
      "can you catch me up",
      "fill me in",
      "what's been happening",
      "give me an update",
      "bring me up to speed",
    ]) {
      expect(matchBriefingIntent(t)).toBe(true);
    }
  });

  it("ignores unrelated commands", () => {
    expect(matchBriefingIntent("take me to my leads")).toBe(false);
    expect(matchBriefingIntent("play some jazz")).toBe(false);
    expect(matchBriefingIntent("")).toBe(false);
  });
});

describe("matchBriefingChoice", () => {
  it("asks the exact scripted question", () => {
    expect(BRIEFING_CHOICE_QUESTION).toBe(
      "Of course Sir. Would you like a full briefing covering all your businesses, a quick summary of the most important things right now, or a specific update on one business or topic?",
    );
  });

  it("detects a full briefing", () => {
    for (const t of [
      "the full briefing",
      "full",
      "everything",
      "cover all my businesses",
      "the whole thing",
      "all of it",
    ]) {
      expect(matchBriefingChoice(t)).toBe("full");
    }
  });

  it("detects a quick summary", () => {
    for (const t of [
      "a quick summary",
      "just the highlights",
      "the most important things",
      "quick",
      "short one",
    ]) {
      expect(matchBriefingChoice(t)).toBe("quick");
    }
  });

  it("treats anything else as a specific topic", () => {
    expect(matchBriefingChoice("how is my restaurant doing")).toBe("specific");
    expect(matchBriefingChoice("update on the facebook campaign")).toBe("specific");
  });

  it("declines cleanly", () => {
    expect(matchBriefingChoice("no")).toBe("none");
    expect(matchBriefingChoice("never mind")).toBe("none");
    expect(matchBriefingChoice("")).toBe("none");
  });
});


// ---------------------------------------------------------------------------
// Speech-pattern learning + Southern/slang canonicalization
// ---------------------------------------------------------------------------
import {
  withTimeout,
  matchStatusIntent,
  matchLearnedPhrase,
  resolveLearnableAction,
  LEARNABLE_ACTIONS,
  CLARIFY_QUESTION,
  CONFIDENCE_THRESHOLD,
} from "./conversationHelpers.js";

describe("Southern/slang canonicalization (normalizeSpeech)", () => {
  it("rewrites casual contractions", () => {
    expect(normalizeSpeech("gimme the rundown")).toBe("give me the rundown");
    expect(normalizeSpeech("lemme hear it")).toBe("let me hear it");
    expect(normalizeSpeech("I'm fixin to leave")).toBe("i m about to leave");
    expect(normalizeSpeech("howdy echo")).toBe("hey echo");
    expect(normalizeSpeech("naw")).toBe("no");
    expect(normalizeSpeech("yessir")).toBe("yes sir");
    expect(normalizeSpeech("aight")).toBe("okay");
  });
  it("fixes dropped-g command verbs only", () => {
    expect(normalizeSpeech("stop talkin")).toBe("stop talking");
    expect(normalizeSpeech("what's happenin")).toBe("what s happening");
    expect(normalizeSpeech("nothin")).toBe("nothing");
    // unknown words are left alone
    expect(normalizeSpeech("griffin")).toBe("griffin");
  });
  it("keeps standard speech untouched", () => {
    expect(normalizeSpeech("Take me to my leads")).toBe("take me to my leads");
  });
});

describe("slang command mappings", () => {
  it("hold up / kill it / cut it interrupt", () => {
    expect(matchInterruptIntent("hold up")).toBe(true);
    expect(matchInterruptIntent("kill it")).toBe(true);
    expect(matchInterruptIntent("kill everything")).toBe(true);
    expect(matchInterruptIntent("shut it down")).toBe(true);
    expect(matchInterruptIntent("cut it")).toBe(true);
    expect(matchInterruptIntent("hey echo hold on")).toBe(true);
  });
  it("bet / run it / let's go mean yes", () => {
    expect(matchYesNo("bet")).toBe("yes");
    expect(matchYesNo("run it")).toBe("yes");
    expect(matchYesNo("let's go")).toBe("yes");
    expect(matchYesNo("send it")).toBe("yes");
    expect(matchYesNo("yessir")).toBe("yes");
  });
  it("nah / naw mean no", () => {
    expect(matchYesNo("nah")).toBe("no");
    expect(matchYesNo("naw")).toBe("no");
  });
  it("what's good means give me an update", () => {
    expect(matchBriefingIntent("what's good")).toBe(true);
    expect(matchBriefingIntent("gimme the rundown")).toBe(true);
    expect(matchBriefingIntent("how we lookin")).toBe(true);
  });
  it("real quick means a quick summary", () => {
    expect(matchBriefingChoice("real quick")).toBe("quick");
    expect(matchBriefingChoice("just real quick")).toBe("quick");
  });
});

describe("matchStatusIntent", () => {
  it("matches direct status asks", () => {
    expect(matchStatusIntent("what we got")).toBe(true);
    expect(matchStatusIntent("what do we got")).toBe(true);
    expect(matchStatusIntent("show me the current status")).toBe(true);
    expect(matchStatusIntent("status report")).toBe(true);
    expect(matchStatusIntent("hey echo what we got today")).toBe(true);
  });
  it("does not match sentences merely containing status words", () => {
    expect(matchStatusIntent("tell me what we got planned for the campaign next month")).toBe(false);
    expect(matchStatusIntent("the status of that invoice is unpaid")).toBe(false);
  });
});

describe("learned phrases", () => {
  const learned = new Map([
    ["squash it", "stop"],
    ["holler at me", "briefing"],
    ["whats cookin", "status"],
  ]);
  it("matches an exact learned phrase after normalization", () => {
    expect(matchLearnedPhrase("Squash it!", learned)).toBe("stop");
    expect(matchLearnedPhrase("holler at me", learned)).toBe("briefing");
  });
  it("never matches inside a longer sentence", () => {
    expect(matchLearnedPhrase("please do not squash it when you file that", learned)).toBe(null);
  });
  it("ignores unknown actions and missing maps", () => {
    expect(matchLearnedPhrase("squash it", new Map([["squash it", "rm -rf"]]))).toBe(null);
    expect(matchLearnedPhrase("squash it", null)).toBe(null);
  });
});

describe("resolveLearnableAction", () => {
  it("maps understood repeats to actions", () => {
    expect(resolveLearnableAction("stop")).toBe("stop");
    expect(resolveLearnableAction("what we got")).toBe("status");
    expect(resolveLearnableAction("catch me up")).toBe("briefing");
    expect(resolveLearnableAction("yes")).toBe("yes");
    expect(resolveLearnableAction("nah")).toBe("no");
    expect(resolveLearnableAction("purple elephants")).toBe(null);
  });
});

describe("clarification constants", () => {
  it("asks the exact natural clarification", () => {
    expect(CLARIFY_QUESTION).toBe(
      "I didn't quite catch that Sir, could you say that again?",
    );
  });
  it("threshold is a sane fraction", () => {
    expect(CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
  it("learnable actions include the core set", () => {
    for (const a of ["stop", "yes", "no", "briefing", "status"]) {
      expect(LEARNABLE_ACTIONS).toContain(a);
    }
  });
});

import {
  withTimeout,
  matchBriefingStart,
  MORNING_STANDBY_GREETING,
  MORNING_MUSIC_READY_LINE,
  matchMusicIntent,
} from "./conversationHelpers.js";

describe("morning standby (matchBriefingStart)", () => {
  it("greeting is the exact standby line", () => {
    expect(MORNING_STANDBY_GREETING).toBe(
      "Good morning Sir. I will be on standby waiting for you to start your morning briefing.",
    );
  });
  it("explicit start phrases work", () => {
    expect(matchBriefingStart("start my briefing")).toBe(true);
    expect(matchBriefingStart("hey echo start my morning briefing")).toBe(true);
    expect(matchBriefingStart("start the briefing")).toBe(true);
    expect(matchBriefingStart("I'm ready")).toBe(true);
    expect(matchBriefingStart("ready")).toBe(true);
    expect(matchBriefingStart("let's do it")).toBe(true);
  });
  it("regular briefing requests count", () => {
    expect(matchBriefingStart("what's good")).toBe(true);
    expect(matchBriefingStart("catch me up")).toBe(true);
    expect(matchBriefingStart("gimme the rundown")).toBe(true);
  });
  it("short go-ahead barks count, on their own only", () => {
    expect(matchBriefingStart("run it")).toBe(true);
    expect(matchBriefingStart("let's go")).toBe(true);
    expect(matchBriefingStart("bet")).toBe(true);
    expect(matchBriefingStart("yeah I was gonna say we should maybe do it later")).toBe(false);
  });
  it("negatives and unrelated speech do not start it", () => {
    expect(matchBriefingStart("nah not now")).toBe(false);
    expect(matchBriefingStart("play some music")).toBe(false);
    expect(matchBriefingStart("take me to my leads")).toBe(false);
    expect(matchBriefingStart("")).toBe(false);
  });
});

describe("matchMusicIntent — saved favorites", () => {
  it("playlist/music/favorites phrasings start the saved list", () => {
    expect(matchMusicIntent("start my music")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play my morning playlist")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play my morning music")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play some of my favorites")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("hey echo play my favorite songs")).toEqual({ action: "favorites", index: 0 });
  });
  it("song-number requests map to the 0-based index", () => {
    expect(matchMusicIntent("play song number two")).toEqual({ action: "favorites", index: 1 });
    expect(matchMusicIntent("play track 5")).toEqual({ action: "favorites", index: 4 });
    expect(matchMusicIntent("play my favorite number one")).toEqual({ action: "favorites", index: 0 });
  });
  it("ordinal phrasings ('my second song') map to the 0-based index", () => {
    expect(matchMusicIntent("hey echo play my second song")).toEqual({
      action: "favorites",
      index: 1,
    });
    expect(matchMusicIntent("play my first song")).toEqual({ action: "favorites", index: 0 });
    expect(matchMusicIntent("play the 3rd track")).toEqual({ action: "favorites", index: 2 });
    expect(matchMusicIntent("play my fifth favorite")).toEqual({ action: "favorites", index: 4 });
  });
  it("generic 'the music' phrasing stays generic play, not favorites", () => {
    expect(matchMusicIntent("play the music")).toEqual({ action: "play", value: "" });
    expect(matchMusicIntent("start playing the music")).toEqual({ action: "play", value: "" });
    expect(matchMusicIntent("play the playlist")).toEqual({ action: "favorites", index: 0 });
  });
  it("search-style play requests still go to YouTube search", () => {
    expect(matchMusicIntent("play some AC/DC")).toEqual({ action: "play", value: "ac dc" });
    expect(matchMusicIntent("play some jazz")).toEqual({ action: "play", value: "jazz" });
  });
  it("skip and stop keep working", () => {
    expect(matchMusicIntent("next song")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip this one")).toEqual({ action: "skip" });
    expect(matchMusicIntent("skip that song please")).toEqual({ action: "skip" });
    expect(matchMusicIntent("stop the music")).toEqual({ action: "stop" });
  });
  it("pause still works as a bare command or with a music noun", () => {
    expect(matchMusicIntent("pause")).toEqual({ action: "pause" });
    expect(matchMusicIntent("pause the music")).toEqual({ action: "pause" });
    expect(matchMusicIntent("hold the music")).toEqual({ action: "pause" });
  });
  it("sentences merely containing skip/next/pause do NOT hijack music", () => {
    expect(matchMusicIntent("what's next on my calendar")).toBe(null);
    expect(matchMusicIntent("skip the intro and show me my leads")).toBe(null);
    expect(matchMusicIntent("put a pause on that campaign")).toBe(null);
    expect(matchMusicIntent("hold my calls this afternoon")).toBe(null);
    expect(matchMusicIntent("what should we do next about the ads")).toBe(null);
  });
  it("non-music speech does not match", () => {
    expect(matchMusicIntent("what are my leads today")).toBe(null);
    expect(matchMusicIntent("")).toBe(null);
  });
});

describe("MORNING_MUSIC_READY_LINE", () => {
  it("is the exact playlist-ready sentence", () => {
    expect(MORNING_MUSIC_READY_LINE).toBe(
      "Your morning playlist is ready whenever you want it Sir.",
    );
  });
});

// ---------------------------------------------------------------------------
// Guided-tour voice commands
// ---------------------------------------------------------------------------
import {
  withTimeout, matchTourCommand } from "./conversationHelpers.js";

describe("matchTourCommand", () => {
  it("yes-style answers advance the tour", () => {
    expect(matchTourCommand("yes")).toBe("next");
    expect(matchTourCommand("Yes sir")).toBe("next");
    expect(matchTourCommand("yeah")).toBe("next");
    expect(matchTourCommand("sure")).toBe("next");
  });
  it("next/continue phrasing advances the tour", () => {
    expect(matchTourCommand("next")).toBe("next");
    expect(matchTourCommand("next one")).toBe("next");
    expect(matchTourCommand("keep going")).toBe("next");
    expect(matchTourCommand("continue")).toBe("next");
    expect(matchTourCommand("I'm ready")).toBe("next");
    expect(matchTourCommand("go ahead")).toBe("next");
  });
  it("back goes back", () => {
    expect(matchTourCommand("back")).toBe("back");
    expect(matchTourCommand("go back")).toBe("back");
  });
  it("stop-style barks end the tour", () => {
    expect(matchTourCommand("stop")).toBe("stop");
    expect(matchTourCommand("that's enough")).toBe("stop");
    expect(matchTourCommand("cancel")).toBe("stop");
  });
  it("ordinary sentences do not drive the tour", () => {
    expect(matchTourCommand("this is your lead inbox where leads land")).toBe(null);
    expect(matchTourCommand("what are my leads today")).toBe(null);
    expect(matchTourCommand("")).toBe(null);
    // Echo's own narration contains these words mid-sentence — must not match.
    expect(matchTourCommand("ready to see the next one sir")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Personal assistant intents (reminders + tasks)
// ---------------------------------------------------------------------------
import {
  withTimeout, matchAssistantIntent } from "./conversationHelpers.js";

describe("matchAssistantIntent", () => {
  it("reminder commands match", () => {
    expect(matchAssistantIntent("Remind me to call the bank at 2 PM tomorrow")).toBe(true);
    expect(matchAssistantIntent("set a reminder for my dentist appointment")).toBe(true);
    expect(matchAssistantIntent("cancel the reminder about the bank")).toBe(true);
    expect(matchAssistantIntent("what are my reminders")).toBe(true);
  });
  it("task commands match", () => {
    expect(matchAssistantIntent("add a task to review the ad budget")).toBe(true);
    expect(matchAssistantIntent("put that on my task list")).toBe(true);
    expect(matchAssistantIntent("what's on my task list")).toBe(true);
  });
  it("completions match", () => {
    expect(matchAssistantIntent("mark off number two")).toBe(true);
    expect(matchAssistantIntent("mark the bank call as done")).toBe(true);
    expect(matchAssistantIntent("I already handled that")).toBe(true);
  });
  it("ordinary chat does not match", () => {
    expect(matchAssistantIntent("how are my ads doing today")).toBe(false);
    expect(matchAssistantIntent("tell me about my leads")).toBe(false);
    expect(matchAssistantIntent("")).toBe(false);
  });
});

describe("withTimeout", () => {
  it("resolves with the promise value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("propagates the original rejection", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects with voice_call_timeout when the promise hangs", async () => {
    const hung = new Promise(() => {});
    await expect(withTimeout(hung, 20)).rejects.toThrow("voice_call_timeout");
  });

  it("does not reject late once the promise already resolved", async () => {
    const v = await withTimeout(
      new Promise((r) => setTimeout(() => r(42), 5)),
      50,
    );
    expect(v).toBe(42);
    // Wait past the timeout window — no unhandled rejection should fire.
    await new Promise((r) => setTimeout(r, 80));
  });
});

// ---------------------------------------------------------------------------
// isProactiveVoiceItem — conversation-priority classification
// ---------------------------------------------------------------------------
import { isProactiveVoiceItem } from "./conversationHelpers.js";

describe("isProactiveVoiceItem", () => {
  it("classifies conversation replies as interactive (never held)", () => {
    expect(isProactiveVoiceItem({ type: "echo_conversation", text: "hi" })).toBe(false);
  });

  it("classifies tour, wizard status, and demo suggestions as interactive", () => {
    expect(isProactiveVoiceItem({ type: "tour" })).toBe(false);
    expect(isProactiveVoiceItem({ type: "status" })).toBe(false);
    expect(isProactiveVoiceItem({ type: "demo-suggestion" })).toBe(false);
  });

  it("classifies presenter demo lines as interactive (never held mid-demo)", () => {
    // The presentation-mode hold in the drain loop holds PROACTIVE items while
    // a demo is live. Demo step lines must be interactive or the demo would
    // hold its own narration and freeze.
    expect(isProactiveVoiceItem({ type: "demo" })).toBe(false);
  });

  it("classifies briefings as proactive", () => {
    expect(isProactiveVoiceItem({ type: "morning_briefing" })).toBe(true);
    expect(isProactiveVoiceItem({ type: "weekly_briefing" })).toBe(true);
  });

  it("classifies anything with a server notificationId as proactive", () => {
    // Pending-poll items (Sage alerts, reminders, hot-lead alerts) always carry
    // a notification id — proactive regardless of their type string.
    expect(isProactiveVoiceItem({ type: "reminder", notificationId: 7 })).toBe(true);
    expect(isProactiveVoiceItem({ type: "sage_alert", notificationId: 9 })).toBe(true);
    // Even an unexpected interactive-looking type is held if it came from the poll.
    expect(isProactiveVoiceItem({ type: "status", notificationId: 3 })).toBe(true);
  });

  it("classifies unknown types as proactive (fail toward not interrupting)", () => {
    expect(isProactiveVoiceItem({ type: "mystery" })).toBe(true);
  });

  it("handles null/undefined without throwing", () => {
    expect(isProactiveVoiceItem(null)).toBe(false);
    expect(isProactiveVoiceItem(undefined)).toBe(false);
  });
});

describe("matchBrandSwitch", () => {
  const brands = [
    { brand_id: "b1", brand_name: "Blacor Homes" },
    { brand_id: "b2", brand_name: "Premier Auto Group" },
  ];

  it("matches switch phrases against real brand names", () => {
    expect(matchBrandSwitch("switch to blacor homes", brands).brand.brand_id).toBe("b1");
    expect(matchBrandSwitch("hey echo switch to premier auto group", brands).brand.brand_id).toBe("b2");
    expect(matchBrandSwitch("change over to blacor", brands).brand.brand_id).toBe("b1");
    expect(matchBrandSwitch("pull up premier auto", brands).brand.brand_id).toBe("b2");
  });

  it("handles shortened and slightly-off spoken names", () => {
    expect(matchBrandSwitch("switch to blacor home", brands).brand.brand_id).toBe("b1");
    expect(matchBrandSwitch("switch to premier", brands).brand.brand_id).toBe("b2");
    expect(matchBrandSwitch("switch to the blacor homes business", brands).brand.brand_id).toBe("b1");
  });

  it("returns ask for a bare switch-businesses request", () => {
    expect(matchBrandSwitch("switch businesses", brands)).toEqual({ ask: true });
    expect(matchBrandSwitch("change business", brands)).toEqual({ ask: true });
    expect(matchBrandSwitch("switch businesses", [])).toBeNull();
  });

  it("returns ask for generic targets like 'another business'", () => {
    // Echo's own greeting suggests this exact phrasing.
    expect(matchBrandSwitch("switch to another business", brands)).toEqual({
      ask: true,
    });
    expect(matchBrandSwitch("hey echo switch to another business", brands)).toEqual({
      ask: true,
    });
    expect(matchBrandSwitch("change to a different one", brands)).toEqual({
      ask: true,
    });
    expect(matchBrandSwitch("switch to the other company", brands)).toEqual({
      ask: true,
    });
    expect(matchBrandSwitch("switch to another business", [])).toBeNull();
  });

  it("never trips on nav phrases or unrelated speech", () => {
    expect(matchBrandSwitch("switch to settings", brands)).toBeNull();
    expect(matchBrandSwitch("go to my leads", brands)).toBeNull();
    expect(matchBrandSwitch("how is blacor homes doing", brands)).toBeNull();
    expect(matchBrandSwitch("", brands)).toBeNull();
  });
});

describe("matchClearNotifications", () => {
  it("matches the natural clear phrasings", () => {
    expect(matchClearNotifications("clear my notifications")).toBe(true);
    expect(matchClearNotifications("clear notifications")).toBe(true);
    expect(matchClearNotifications("clear all notifications")).toBe(true);
    expect(matchClearNotifications("Hey Echo, clear my notifications")).toBe(true);
    expect(matchClearNotifications("dismiss all notifications")).toBe(true);
    expect(matchClearNotifications("dismiss my notifications")).toBe(true);
    expect(matchClearNotifications("get rid of these notifications")).toBe(true);
    expect(matchClearNotifications("mark all notifications as read")).toBe(true);
    expect(matchClearNotifications("wipe my notifications")).toBe(true);
  });

  it("does not trip on unrelated clear commands or empty input", () => {
    expect(matchClearNotifications("clear the music")).toBe(false);
    expect(matchClearNotifications("clear my tasks")).toBe(false);
    expect(matchClearNotifications("clear the screen")).toBe(false);
    expect(matchClearNotifications("what are my notifications")).toBe(false);
    expect(matchClearNotifications("go to my leads")).toBe(false);
    expect(matchClearNotifications("")).toBe(false);
    expect(matchClearNotifications(null)).toBe(false);
  });

  it("clear phrases are not interpreted as a yes/no answer", () => {
    // The clear command must be handled as its own intent, never learned or
    // resolved as a "yes" (which would corrupt other yes/no flows).
    expect(matchYesNo("clear my notifications")).toBeNull();
    expect(matchYesNo("dismiss all notifications")).toBeNull();
  });
});

describe("matchContentCreateIntent", () => {
  it("matches core create-content phrasings", () => {
    expect(matchContentCreateIntent("let's create some content")).toEqual({
      request: "",
    });
    expect(matchContentCreateIntent("Hey Echo, let's create some content")).toEqual({
      request: "",
    });
    expect(matchContentCreateIntent("create some posts")).toEqual({
      request: "",
    });
    expect(matchContentCreateIntent("can you draft some social media posts")).toEqual(
      { request: "" },
    );
    expect(matchContentCreateIntent("make some content")).toEqual({
      request: "",
    });
    expect(
      matchContentCreateIntent("i want you to write some marketing content"),
    ).toEqual({ request: "" });
  });

  it("captures a trailing topic hint", () => {
    expect(
      matchContentCreateIntent("let's create some content about the summer sale"),
    ).toEqual({ request: "about the summer sale" });
  });

  it("matches natural 'ready to do a facebook post' phrasing", () => {
    expect(
      matchContentCreateIntent("Hey Echo, I'm ready to do a Facebook post"),
    ).toEqual({ request: "for facebook" });
    expect(matchContentCreateIntent("i m ready to do a facebook post")).toEqual({
      request: "for facebook",
    });
    expect(matchContentCreateIntent("ready to create some posts")).toEqual({
      request: "",
    });
    expect(matchContentCreateIntent("do a facebook post")).toEqual({
      request: "for facebook",
    });
    expect(
      matchContentCreateIntent("let's do an instagram post about move-in specials"),
    ).toEqual({ request: "for instagram about move in specials" });
  });

  it("does NOT match unrelated sentences", () => {
    expect(matchContentCreateIntent("open the content calendar")).toBeNull();
    expect(matchContentCreateIntent("what content is scheduled")).toBeNull();
    expect(matchContentCreateIntent("I made some coffee")).toBeNull();
    expect(matchContentCreateIntent("create a new brand")).toBeNull();
    expect(matchContentCreateIntent("")).toBeNull();
  });
});

describe("matchContentReviewCommand", () => {
  it("approve requires an explicit approve/schedule phrase", () => {
    expect(matchContentReviewCommand("approve")).toEqual({ action: "approve" });
    expect(matchContentReviewCommand("Approve it")).toEqual({
      action: "approve",
    });
    expect(matchContentReviewCommand("schedule it")).toEqual({
      action: "approve",
    });
    expect(matchContentReviewCommand("yes, schedule it")).toEqual({
      action: "approve",
    });
    // Loose agreement alone must NOT schedule anything.
    expect(matchContentReviewCommand("yes")).toBeNull();
    expect(matchContentReviewCommand("sounds good")).toBeNull();
    expect(matchContentReviewCommand("okay")).toBeNull();
  });

  it("skip / repeat / done / image commands", () => {
    expect(matchContentReviewCommand("skip it")).toEqual({ action: "skip" });
    expect(matchContentReviewCommand("next one")).toEqual({ action: "skip" });
    expect(matchContentReviewCommand("read it again")).toEqual({
      action: "repeat",
    });
    expect(matchContentReviewCommand("that's all")).toEqual({ action: "done" });
    expect(matchContentReviewCommand("we're done")).toEqual({ action: "done" });
    expect(matchContentReviewCommand("create the visual")).toEqual({
      action: "image",
    });
    expect(matchContentReviewCommand("can you make the image")).toEqual({
      action: "image",
    });
  });

  it("revision instructions carry the raw text", () => {
    expect(
      matchContentReviewCommand("make it shorter and punchier"),
    ).toEqual({ action: "revise", instruction: "make it shorter and punchier" });
    expect(matchContentReviewCommand("add a mention of the discount")).toEqual({
      action: "revise",
      instruction: "add a mention of the discount",
    });
    expect(matchContentReviewCommand("change the opening line")).toEqual({
      action: "revise",
      instruction: "change the opening line",
    });
  });

  it("unrecognized speech returns null (caller asks for guidance)", () => {
    expect(matchContentReviewCommand("hmm interesting")).toBeNull();
    expect(matchContentReviewCommand("")).toBeNull();
  });
});

describe("speakableDraft", () => {
  it("speaks position, platform, content and schedule slot", () => {
    const line = speakableDraft(
      {
        platform: "facebook",
        postContent: "Big news this week!",
        scheduledTime: "2026-07-14T14:00:00.000Z",
      },
      0,
      3,
    );
    expect(line).toContain("first one, for Facebook");
    expect(line).toContain("Big news this week!");
    expect(line).toContain("I'd schedule it for");
  });

  it("handles single draft and missing time", () => {
    const line = speakableDraft(
      { platform: "linkedin", postContent: "Hello" },
      0,
      1,
    );
    expect(line).toContain("for LinkedIn");
    expect(line).not.toContain("I'd schedule");
  });
});

describe("matchAutopilotReviewIntent", () => {
  it("matches natural review-the-batch phrasings", () => {
    expect(matchAutopilotReviewIntent("let's review the batch")).toEqual({
      review: true,
    });
    expect(matchAutopilotReviewIntent("Hey Echo, review the batch")).toEqual({
      review: true,
    });
    expect(
      matchAutopilotReviewIntent("walk me through this week's batch"),
    ).toEqual({ review: true });
    expect(matchAutopilotReviewIntent("go over the approvals")).toEqual({
      review: true,
    });
    expect(matchAutopilotReviewIntent("what's in the batch")).toEqual({
      review: true,
    });
    expect(matchAutopilotReviewIntent("show me the batch")).toEqual({
      review: true,
    });
  });

  it("ignores unrelated talk about batches or reviews", () => {
    expect(matchAutopilotReviewIntent("review the reviews on google")).toBeNull();
    expect(matchAutopilotReviewIntent("I made a batch of cookies")).toBeNull();
    expect(matchAutopilotReviewIntent("review")).toBeNull();
    expect(matchAutopilotReviewIntent("")).toBeNull();
  });
});

describe("matchAutopilotSetupIntent", () => {
  it("matches setup / turn-on phrasings", () => {
    expect(matchAutopilotSetupIntent("set up autopilot")).toEqual({
      setup: true,
    });
    expect(matchAutopilotSetupIntent("Hey Echo, turn on autopilot")).toEqual({
      setup: true,
    });
    expect(
      matchAutopilotSetupIntent("can you help me set up auto pilot mode"),
    ).toEqual({ setup: true });
    expect(matchAutopilotSetupIntent("enable autopilot")).toEqual({
      setup: true,
    });
  });

  it("ignores plain mentions of autopilot", () => {
    expect(matchAutopilotSetupIntent("what is autopilot")).toBeNull();
    expect(matchAutopilotSetupIntent("autopilot")).toBeNull();
    expect(matchAutopilotSetupIntent("")).toBeNull();
  });
});

describe("speakableAutopilotItem", () => {
  it("speaks the exact daily budget aloud for ads", () => {
    const line = speakableAutopilotItem(
      {
        itemType: "ad",
        platform: "facebook",
        adHeadline: "Big Sale",
        adDailyBudget: 15,
        postContent: "Shop now and save.",
      },
      1,
      3,
    );
    expect(line).toContain("Item 2 of 3");
    expect(line).toContain("at 15 dollars a day");
    expect(line).toContain("Big Sale");
    expect(line).toContain("Shop now and save.");
  });

  it("omits the budget phrase when no budget is set", () => {
    const line = speakableAutopilotItem(
      { itemType: "ad", adHeadline: "H", postContent: "Body" },
      0,
      1,
    );
    expect(line).not.toContain("dollars a day");
    expect(line).toContain("test ad");
  });

  it("reads posts like content drafts with platform name", () => {
    const line = speakableAutopilotItem(
      { itemType: "post", platform: "twitter", postContent: "Hello world" },
      0,
      2,
    );
    expect(line).toContain("The first one is a X post:");
    expect(line).toContain("Hello world");
  });
});
