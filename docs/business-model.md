# Business model

How the project plans to sustain itself. This is a plan, not an offer: no plan is on sale yet and no price is set. The decisions below were taken on 2026-10-02; anything that depends on a measurement is marked as a target.

## Open source first

Everything stays open source under AGPL-3.0. Anyone can run their own office with the Docker image and the [self-hosting guide](../deploy/README.md), with every feature, at no cost beyond their own server. Paying buys hosting and support, not features: there is no open core, and a hosted office never gets a feature the open source build lacks.

## Market

International from the start: the product and docs are in English, prices are in US dollars and customers can be anywhere. The project is run from Brazil and sells abroad.

## Hosted plans

For teams that do not want to run a server: a dedicated office on its own machine, kept updated, backed up and monitored. One installation serves one office, so a separate machine per customer keeps media and data apart without multi-tenant code.

| Plan | For | Seats (target) | Planned machine | How to buy |
| --- | --- | --- | --- | --- |
| **Team** | small teams | up to 25 | 2 dedicated vCPU, 8 GB (Hetzner CCX13 class) | self-service |
| **Business** | small companies | up to 75 | 4 dedicated vCPU, 16 GB (Hetzner CCX23 class) | self-service |
| **Enterprise** | larger organisations, special needs | agreed per contract | sized per contract | contact sales |

The seat counts are **targets**. They become promises only after each machine has been measured with the load generator on another machine (see the [roadmap](roadmap.md)); if the measurement does not support them, the numbers change.

- **A seat** is a registered member of the office. Each plan also has a fair-use limit on people in calls at the same time, because media is what costs; that limit comes from the same measurement.
- **Regions at launch:** US East (Ashburn) and the EU (Germany); the customer chooses. Singapore is added when someone asks for it. Before the first EU customer signs, the privacy policy and a data processing agreement must meet the GDPR.
- **Enterprise** is where single sign-on, audit export, custom terms, data residency and a service-level agreement live. None of these is built yet.

## Pricing

A flat monthly price per plan, covering up to its seats, billed monthly or annually; a year costs ten months. Prices are not set: they come from this formula once the machines are measured.

~~~text
price >= (server + media bandwidth + backups + monitoring + support time + payment fees) x (1 + margin)
~~~

- *server*: the machine the plan's seats need, measured as described in [Benchmark results](benchmark-results.md);
- *media bandwidth*: grows with the number of people in calls at the same time and with video, much more than with registered seats;
- *support time*: hours per month the plan includes, at the cost of that time.

`bench/cost.py` holds the server part of the formula and needs these prices filled in. Reference points, checked on 2026-10-02 (they are inputs and comparisons, not Tilework prices):

| Item | Price | Source |
| --- | --- | --- |
| Gather 1.0 | US$15 per user per month, or US$12 billed annually; charged by the number of people who can be in the space at once | [Gather support](https://support.gather.town/articles/2904336860-start-and-manage-monthly-or-annual-gather-1-0-subscriptions) |
| Hetzner CCX13 (2 dedicated vCPU, 8 GB) | €42.99 or US$50.49 per month in Germany and Finland; US$50.99 in the US | [Hetzner price list](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), excluding VAT and the IPv4 address |
| Hetzner CCX23 (4 dedicated vCPU, 16 GB) | €85.99 or US$101.49 per month in Germany and Finland; US$102.99 in the US | same |
| Paddle | 5% + US$0.50 per transaction | [Paddle](https://www.paddle.com/paddle-101) |

For scale: 25 people on Gather's annual price is about US$300 per month.

## Selling and support

- **Payments:** Paddle, as merchant of record: it sells to the customer, collects and remits sales tax and VAT in each country and handles refunds and chargebacks. Stripe can be reconsidered if volume makes its lower fee worth handling taxes directly.
- **Trial:** the [public demo](https://office.152-67-49-137.sslip.io) is the trial, and the first month of a paid plan can be refunded.
- **Support:** Team and Business get email support during business hours (São Paulo time), with no formal service-level agreement. Enterprise gets an agreement with an availability commitment, negotiated per contract.

## Contributions and licensing

Because nothing will be sold under another licence, outside contributions need no contributor licence agreement. They will be accepted under the Developer Certificate of Origin: each commit is signed off (`git commit -s`). Adopting it in the contributing guide and CI is on the roadmap.

## Name

The hosted service uses the **Tilework** name. Before it is announced, check the domain and run trademark searches in the markets it is sold to (USPTO, EUIPO and INPI).

## Goal

**Target:** three paying customers within six months, by early April 2027. The order of work that serves it is in the [roadmap](roadmap.md#order-of-work).

## Still open

- The legal entity for selling software abroad from Brazil, and its taxes: decide with an accountant before the first sale.
- The price of each plan, after the machines are measured.
- The fair-use limit on simultaneous calls, from the same measurement.
- The domain and the result of the trademark searches.
