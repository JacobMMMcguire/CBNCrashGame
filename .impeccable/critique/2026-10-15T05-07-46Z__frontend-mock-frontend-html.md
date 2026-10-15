---
target: frontend/mock_frontend.html
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lynbo\\CBNCrashGame\\frontend\\mock_frontend.html"
target_fingerprint: "sha256:e79f61ca3384675b63b1f7a0e834568dd05774c04c76fb551b3565e83c6eaaf4"
target_path: "C:\\Users\\lynbo\\CBNCrashGame\\frontend\\mock_frontend.html"
timestamp: 2026-10-15T05-07-46Z
slug: frontend-mock-frontend-html
---
# Critique: frontend/mock_frontend.html (pre-fix render)

Method: dual-agent (A: design review, B: detector + headless Edge evidence)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Eject label contradicted state ("Collect 184.00" after abort) |
| 2 | Match system / real world | 3 | Rocket lay flat at launch |
| 3 | User control and freedom | 2 | No cancel-bet; auto-eject "×" looks like a clear button |
| 4 | Consistency and standards | 2 | Cashed out/Crashed vs Ejected/Aborted vocabulary drift |
| 5 | Error prevention | 2 | Free-text wager, no invalid states; global Space key |
| 6 | Recognition rather than recall | 3 | Log mixes crash point and player result |
| 7 | Flexibility and efficiency | 3 | No repeat-last-bet |
| 8 | Aesthetic and minimalist design | 2 | Letterboxed chart left ~130px dead band; orphan chip |
| 9 | Error recovery | 1 | No error states mocked |
| 10 | Help and documentation | 2 | No how-to-play beyond status line |
| **Total** | | **22/40** | Acceptable |

Priority issues: [P1] Eject label clobbered in non-flying states; [P1] stage letterboxing / pad below fold; [P1] mobile overflow (sr-only escaping log strip) and Eject below fold in flight; [P2] atlas grammar stops at chart edge; [P2] regret framing after eject.
Detector: 1 finding (border-accent-on-rounded on kbd), fixed; rerun clean.
Applied: top 3 P1 fixes plus day chip contrast and chip row.
