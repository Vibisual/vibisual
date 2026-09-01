# Contributing to Vibisual

Thanks for your interest in contributing. Before submitting a pull request,
please read the following.

## License of Contributions

By submitting a pull request or any contribution to this repository, you
agree that your contribution is provided under the terms of the
[Apache License 2.0](LICENSE).

In addition, you agree to the **Developer Certificate of Origin (DCO)**
below. The DCO is a lightweight, widely-used alternative to a formal CLA
(used by the Linux kernel, GitLab, Docker, Chef, and others). It is a
statement that you have the right to submit the work under the project
license.

## Developer Certificate of Origin

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

### How to sign off

Add a `Signed-off-by` line to every commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

You can do this automatically with `git commit -s`.

Every commit in a pull request is checked for that line by the `DCO`
workflow, matched against the commit author's address. If one is
missing, fix the most recent commit with `git commit --amend --signoff`,
or the whole branch with `git rebase --signoff <base>`, then force-push.

## Additional License Grant (Trademark and Future Licensing)

In addition to the Apache 2.0 grant, by submitting a contribution you
also grant 길근오 (the project owner) a **perpetual, worldwide,
non-exclusive, royalty-free, irrevocable license** to:

  1. Relicense your contribution, in whole or in part, under:

       - any OSI-approved open source license;
       - any source-available license that is not OSI-approved — for
         example the Business Source License 1.1, the Functional
         Source License, or a similar license that converts to an
         open source license after a set period; or
       - a proprietary or commercial license used for any product or
         service this project offers, whether hosted, embedded, or
         distributed as an application,

     provided that the Apache 2.0 grant already published for your
     contribution stays in effect for existing users of the versions
     in which it was published.

  2. Sublicense your contribution as part of larger works that
     include the project.

This keeps the project's licensing options open. It lets Vibisual ship
a paid hosted or commercial edition, dual-license specific modules, or
move the core to a different license later — including a
source-available one such as BUSL-1.1 — without collecting sign-off
from every past contributor. The projects that made that move cleanly
(Sentry, HashiCorp) could do so because they asked for this grant up
front; the ones that did not had to track down every contributor years
later.

What this grant does **not** allow is taking back what has already
shipped. Every release published under Apache 2.0 stays under Apache
2.0, and so does your contribution inside it.

You retain full copyright in your contribution. You also retain the
right to use, distribute, and license your contribution independently
under any other terms.

This additional grant is not optional. A contribution that does not
carry it cannot be merged, because a single exception would bind every
future version of the module it touches. If that is a problem for you —
an employer IP policy, for example — please open a discussion first. We
would rather build the idea ourselves from your issue than leave part of
the project unable to move.

## Code of Conduct

Be kind. Assume good intent. Personal attacks, harassment, and
bad-faith behavior will result in removal.

## How to Contribute

1. Open an issue first for non-trivial changes.
2. Fork the repository and create a feature branch.
3. Write tests where applicable.
4. Run `pnpm typecheck` and `pnpm test` before pushing.
5. Open a pull request with a clear description of what and why. The
   pull request template asks you to confirm the sign-off and the
   Additional License Grant above — please tick both boxes.

## Questions

If you are unsure whether you can contribute (e.g., due to your
employer's IP policy), please open a discussion before sending a
pull request.
