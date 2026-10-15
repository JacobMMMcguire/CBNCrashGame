# CBN Crash Game

A casino-style crash game built for the **Canadian Bank Note** sponsor challenge at **ThunderHacks 2026**.

Players place a wager and watch a multiplier climb in real time. Cash out before it crashes to win `wager × multiplier`; wait too long and the wager is lost.

See [`ThunderHacksII_CBN_Problem_Statement.pdf`](ThunderHacksII_CBN_Problem_Statement.pdf) for the full brief.

## MVP requirements

- [ ] **Controls**: Place Bet and Cash Out
- [ ] **Display**: account balance, wager amount, current multiplier
- [ ] **Balance tracking**
- [ ] **Crash point & outcome**: random crash point between 1.00x and a configurable maximum, with round resolution

## Gameplay flow

1. Player places a wager and starts a round.
2. The wager is deducted from the balance.
3. A random crash point is generated between 1.00x and the maximum multiplier.
4. The multiplier increases in real time.
5. Cashing out before the crash adds `wager × current multiplier` to the balance.
6. If the crash happens first, the wager is lost.
7. The game resets for the next round.

## Judging rubric (50 pts)

| Category | Points | Focus |
| --- | --- | --- |
| Presentation Layer | 10 | UI quality, responsiveness, theme consistency, usability, gameplay feedback |
| Backend Layer | 10 | Game logic, account management, RNG, security, reliability |
| Modularity & Configurability | 10 | Code quality, maintainability, extensibility, localization |
| Creativity & Polish | 20 | Innovation, visual appeal, engagement, overall impact |

## Optional enhancements

Auto cash out, configurable betting options, session history, bonus rounds, analytics, accessibility, localization, multiplayer.

## Getting started

_Tech stack and setup instructions coming soon._

## Team

_Add team members here._
