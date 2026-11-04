# OF4 Lighthouse: the prototype journey

29 to 30 October 2026. Built by Sujit for OF4, customer insights and brand monitoring.

## Why it exists

Dhruv asked for a clear win for the OF4 outcome family: one working prototype on one or two platforms, in its own repository, due Wednesday 28 October. Lighthouse is that win. Dhruv saw it and agreed with the direction. It stopped there on 30 October, then on 4 November it became the test bed for the shared connector layer (section 4 November below).

## The idea in one line

A small business owner never misses a customer message, and can prove it.

```
14 arrived: 8 answered, 5 waiting, 1 spam, 0 missed
```

| Owner's problem | What Lighthouse does |
|---|---|
| Messages are spread over WhatsApp, Instagram, Facebook and Google | One list, every channel |
| No idea which message matters most | Today's 3: the three most urgent, with the reason in plain words |
| Replying takes time | A draft in the owner's own tone, edited and sent from the list |
| An unread badge proves nothing | The counts line. Arrived always equals answered plus waiting plus spam |
| Spam hides real customers | Spam is counted, never deleted, and can be brought back |

## The ideology

1. **Facts, not mood scores.** Urgency comes from stars, hours waiting, refund or delivery words and repeat customers. The reason is always shown.
2. **Proof over promise.** "0 missed" is a database query, not a label. If it ever fails, the screen turns red.
3. **Counted once.** Each message gets an id from its content, so loading the same data twice adds nothing.
4. **Simple for the owner.** Few buttons: Reply, Mark answered, Spam, Undo. No agents, no jargon on screen.
5. **Never invent.** Drafts come from the owner's own lines and the message. Nothing is claimed that the message did not say.

## How it was built, step by step

```mermaid
flowchart LR
    A["29 Oct<br/>README, PRD, architecture"] --> B["29 Oct<br/>Reader, inbox, reply drafts"]
    B --> C["29 Oct<br/>Insights agent on Gemini"]
    C --> D["29 Oct<br/>Connectors: one pipeline<br/>for every channel"]
    D --> E["29 Oct<br/>Landing to channels to inbox"]
    E --> F["30 Oct<br/>Facebook live through Composio"]
    F --> G["30 Oct<br/>WhatsApp live through<br/>Meta's webhook"]
```

| Date | Commit | What changed for the owner |
|---|---|---|
| 29 Oct | 7e79db3 | The README: what Lighthouse is and how to run it |
| 29 Oct | 2c95860 | Load a WhatsApp chat export or a reviews file and see one ranked list with draft replies |
| 29 Oct | 004a212 | "What customers keep saying": themes tied to the real messages |
| 29 Oct | 85a6ee5 | The agents run on Gemini; themes clear when the owner starts over |
| 29 Oct | 5db67d7 | WhatsApp, Instagram, Facebook and Google reviews all feed one pipeline |
| 29 Oct | 8dcdcbf | The owner walks from the landing page to connecting channels to the inbox |
| 30 Oct | 4ab4ab8 | Facebook is live: real comments arrive and a reply posts back to the Page |
| 30 Oct | 802665c | WhatsApp is wired to receive and answer live through Meta's webhook |

## 4 November: the shared connector layer

Dhruv and Sujit, call of 4 November: Composio and Zernio are both implemented, permissions start at the connector level, the lead loop runs on Mastra as in swayu-app, and everything is tested hands on with real test accounts. Lighthouse is where that was built.

```mermaid
flowchart LR
    A["Gateway<br/>permission check, routes"] --> B["Composio and Zernio<br/>one item shape"]
    B --> C["Cedar rules<br/>schema checked"]
    C --> D["Replies lead on Mastra<br/>real model"]
    D --> E["Held reply becomes<br/>a draft in the inbox"]
    E --> F["Drafts written on their own,<br/>checked, owner presses Send"]
    F --> G["Activity page<br/>every call in plain words"]
```

| Commit | What changed for the owner |
|---|---|
| 699881f, 4936a67 | One gateway in front of every channel, with Composio and Zernio behind it |
| a590be5, 1cd5bd7, 7ad5466 | Each lead gets only the tools its rules allow; the rules are Cedar, checked against a schema at startup |
| 74e458b, 7af5fb1, 35a4f8f, 230b49b | Both providers read the same real comments; the Page's own comments are never counted as customers |
| 05b491f | The inbox reads and replies through the gateway; pressing Send is the owner's approval |
| 954310d, b195a4b | The replies lead runs on the real model and can use its tools |
| 40fa38c, 63aa942 | A reply the lead writes is checked and kept on its message as a draft; new messages get one on their own |
| 8d2388a, 18addb4 | The ready reply sits on its card with Send; Activity lists every call in one sentence each |
| cc46bfd, b1e7915, 4e11938 | The inbox opens again after Cedar; a busy model never costs a draft; replies speak as the owner |

### Measured on the test accounts, 4 November

| Check | Result |
|---|---|
| Facebook read, same Page, both providers | Both read the same comments. Zernio named all 12 authors; Composio named 8 of 12 |
| Instagram read | Both read all 7 comments, every author named |
| Facebook reply through Composio | 5 of 5 posted |
| Clean start, live | 12 Facebook and 7 Instagram messages in through Zernio, 0 missed; all 17 waiting messages got a draft in the owner's voice |
| Checker on lead drafts | Stopped one draft that offered a refund the owner never offers |
| Cost | About 0.007 dollars for a full drafting pass with the reader |
| Tests | 157 of 157 pass, typecheck clean, each new guard broken once to see its test fail |
| Not proven | A reply through Zernio on any channel; Instagram replies on either provider; Google reviews without a real profile; WhatsApp from a real phone |

Gemini's free tier allows 15 calls a minute and answered 503 "high demand" several times on 4 November. The product keeps working when it does: messages still arrive and count, and drafting retries a minute later.

## What it is built with

Full stack and architecture diagram: [`tech-stack.md`](tech-stack.md).

| Part | Choice | Why |
|---|---|---|
| Screens and buttons | Next.js 16 and React 19, server actions | No separate API to keep in step |
| Data | Postgres 18 | The counts line and "counted once" are database rules |
| Checking channels | The open inbox checks connected channels every 30 seconds | Fastest to prove; webhooks or a server job replace it |
| Agents | Gemini, key read from 1Password at start | Insights and themes |
| Facebook | Composio | Fastest path to a real read and reply on a test Page |
| WhatsApp | Meta Cloud API webhook | Meta pushes each message to us |
| Secrets | 1Password references in `.env.op` | No value ever sits in a file |

## The channel design

```mermaid
flowchart LR
    FB["Facebook Page"] -- "Composio, checked every 30 s" --> P["One pipeline"]
    WA["WhatsApp"] -- "Meta pushes to the webhook" --> G["Tunnel guard<br/>Signature check"] --> P
    F["WhatsApp export, reviews CSV"] --> P
    P --> DB["Postgres<br/>one row per message"]
    DB --> UI["Inbox, Today's 3,<br/>counts line"]
    UI -- "Send reply" --> FB
    UI -- "Send reply" --> WA
```

WhatsApp safety, three locks:
1. **Verify handshake.** Meta's setup call is answered only with the right verify token. A wrong token gets 403.
2. **Signature check.** Every message must carry Meta's signature made with our app secret. Unsigned gets 401.
3. **Tunnel guard.** Through the public tunnel only the webhook is reachable. The inbox through the tunnel gets 404.

## Proof

| Check | Result |
|---|---|
| Tests | 103 of 103 pass, typecheck clean |
| Tunnel guard mutation test | Goes red when the guard is removed |
| WhatsApp webhook on the running server | Handshake echoes the challenge; wrong token 403; unsigned 401; inbox through tunnel 404 |
| Facebook live | 2 real comments caught; reply "Thank you so much! Lighthouse test reply." read back from Facebook at 10:33:29 UTC |
| Meta test number | +1 555-143-6423, quality GREEN |
| Not proven | WhatsApp end to end with a real message from a phone. The prototype stopped before that test |

Screenshots: Research drive, Evidence, folder "2026-10-30 Sujit OF4 connectors".

## Designs and records kept as evidence

| Artifact | What it holds |
|---|---|
| [Swayu One Inbox](https://claude.ai/artifact/1deqpCABnmCiz98pJQtzg9) | The first design of the one inbox, before any code |
| [Lighthouse Real Channels](https://claude.ai/artifact/Rf8ANyaRsrJGpTDjfMRV1M) | How each real channel connects; source in `docs/artifacts/connect-real-channels.html` |
| [Lighthouse Connector Build Log](https://claude.ai/artifact/P8fwK58NyA9yZpNsLJNVEj) | Connector build versus buy, benchmarks; source in `docs/artifacts/connectors-build-vs-buy.html` |
| [OF4 Design Record](https://claude.ai/artifact/RQeawJQe1ic16NfAVsWzWK) | Every OF4 decision, finding and file, newest first |

## Limits we found

| Limit | Number | What it means |
|---|---|---|
| Meta Pages calls | 4,800 times engaged users per 24 hours | A new Page with 0 followers is near the minimum |
| Composio Hobby | 100,000 calls a month | Our 30 second check uses about 14,400 calls a day per open inbox |
| Composio Pro | $29 plus $0.0003 a call | About 700 dollars per owner per month at a 30 second check |
| WhatsApp service replies | 1,000 free per number a month since 1 Oct 2026, then paid | Cost grows with replies |
| WhatsApp test token | Expires 24 hours after it is made | A real demo needs a permanent system user token |
| Meta Tech Provider onboarding | 200 new customers per 7 days | 1,000 owners take at least five weeks after approval |

## What the research says for the real build

From the research of 30 October, in `~/swayu-handover/research/`:

1. **Meta approvals set the calendar, not the code.** Business Verification, App Review and Tech Provider must start early under Swayu's company portfolio.
2. **Push, not polling.** Webhooks plus a nightly catch up keep "0 missed" honest and cut cost. The 30 second check does not survive scale.
3. **Replying is posting in the owner's name.** It touches rule 1 and needs Harish's word before it ships in swayu-app.
4. **Auto send only safe replies.** Never anything with money, dates, complaints or low stars.
5. **Customer messages need their own retention policy** under rule 9.
6. **OF4 must write down its needs from the shared connector layer now**, so it does not build a parallel inbox that clashes with the stream later.

## Open, for whoever picks this up

| Item | Owner |
|---|---|
| Meta Business Verification, App Review, Tech Provider | Question for Harish |
| Who builds the shared connectors and reply path, and when | Question for Dhruv |
| WhatsApp end to end with a real phone | Not done; prototype stopped |
| Instagram, Facebook webhooks, one click Connect with Meta | Not started; prototype stopped |
