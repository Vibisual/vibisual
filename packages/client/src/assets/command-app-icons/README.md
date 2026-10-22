# Bundled command-app icons — sources, licenses, trademarks

`../../components/commandAppBrandIcons.ts` shows these marks on app bubbles detected from shell commands
(SSOT §5.1, "앱 아이콘은 그 앱이 실제로 쓰는 그림이다"). They stand in only for commands whose own executable
shows no app icon: `git.exe` carries none, and POSIX command-line programs never do. Every other app shows
the icon read from its installed executable on the user's machine; nothing here is drawn on top of or
in place of such an icon.

A mark is bundled **only when its owner licenses the artwork for this kind of use** — referring to the
program the agent ran, unaltered, without implying endorsement. Attribution for the copies below is also in
the repository `NOTICE`, which ships with every installer.

| File | Program | Source (fetched 2026-10-20) | Copyright / license | Trademark basis |
|---|---|---|---|---|
| `git.svg` | Git | <https://git-scm.com/images/logos/downloads/Git-Icon-1788C.svg> (unmodified) | Git Logo by Jason Long, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Git Project trademark policy §2.2 permits the marks "to identify the Git software" (<https://git-scm.com/about/trademark>) |
| `curl.svg`, `curl-white.svg` | curl | <https://curl.se/logo/curl-symbol.svg>, <https://curl.se/logo/curl-white-symbol.svg> (unmodified) | curl project: "You are free to use the images for purposes of showing your use of curl" (<https://curl.se/logo/>) | same page |
| `php.svg` | PHP | <https://www.php.net/images/logos/new-php-logo.svg> (unmodified) | PHP logo by Colin Viebrock, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (<https://www.php.net/download-logos.php>) | released by php.net for reuse |
| `ruby.png` | Ruby | `ruby-kit/ruby.png` from <https://cache.ruby-lang.org/pub/misc/logo/ruby-logo-kit.zip>, **resized** from 995×996 to 128×128 | The Ruby Logo, Copyright (c) 2006 Yukihiro Matsumoto, [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) — [LICENSE-ruby.txt](LICENSE-ruby.txt). The resized copy is under the same license. | used only to represent the Ruby language (`ruby`, `irb`), as the kit asks |
| `perl.svg` | Perl | `blessed/exports/perl-081-64.svg` from [metacpan/perl-assets@d942561f](https://github.com/metacpan/perl-assets/blob/d942561f594feab70c7a8905d70d675c4bdd4d31/blessed/exports/perl-081-64.svg) (unmodified) | Perl logo by Zach Roszczewski and Sébastien Feugère, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — <https://perl.org> | the repository asks IDE icon designers to draw from these exports |
| `yarn.svg` | Yarn | `yarn-kitten-circle.svg` from [yarnpkg/assets@b28fd5a0](https://github.com/yarnpkg/assets/blob/b28fd5a09430a7b7701dbebe1765fe166c389cc6/yarn-kitten-circle.svg) (unmodified) | Yarn assets, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | official asset repository |
| `pnpm.svg` | pnpm | `static/img/pnpm-no-name-with-frame.svg` from [pnpm/pnpm.io@f05d3514](https://github.com/pnpm/pnpm.io/blob/f05d35143162810ac84377b5a064edf5c2826226/static/img/pnpm-no-name-with-frame.svg) (unmodified) | Copyright (c) 2016-2022 Zoltan Kochan and other contributors, MIT — [LICENSE-pnpm.txt](LICENSE-pnpm.txt) | official logo, offered at <https://pnpm.io/logos> |
| `godot.svg` | Godot Engine | `misc/logo/icon.svg` from [godotengine/godot@925fbbc5](https://github.com/godotengine/godot/blob/925fbbc5c4cb34ca4377b3231b2dc1b8d3a7d187/misc/logo/icon.svg) (unmodified) | Godot Engine Logo, Copyright (c) 2017 Andrea Calabró, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — [LICENSE-godot.txt](LICENSE-godot.txt) | press kit: "Only use the logo and icon to represent Godot", undistorted, no endorsement (<https://godotengine.org/press/>) |

## Marks deliberately not bundled

These commands show their executable's own icon where it has one (for example `node.exe` and `python.exe`
on Windows), otherwise the generic terminal glyph:

- **Node.js, npm** — OpenJS Foundation policy and npm's logo policy allow the logos only with permission.
- **Python** — the PSF allows the unaltered logo, but only with the ™ symbol always shown, which an icon cannot carry.
- **Rust / Cargo** — the artwork is CC BY, but the trademark policy does not cover UI icons and asks to be contacted.
- **Docker, Go, PostgreSQL** — logo use needs prior approval or forbids showing the logo next to other marks.
- **Deno, Bun, .NET, Java, SQLite, FFmpeg, CMake** — no published license or permission for this use of the logo.
- **ImageMagick** — license permits it, but the official icon is a detailed illustration that is unreadable at icon size.
- **Unreal Engine, Blender, Unity, Visual Studio Code and other desktop apps** — never bundled; their installed executable provides the icon.

## Adding a mark

Add a file only when the mark's owner publishes a license that permits redistribution **and** permits
using the logo to refer to the program. Keep the file unmodified where the owner asks for that, record the
source with a pinned commit or URL, add the license text if the license requires it, update `NOTICE`, and
add the brand to `COMMAND_APP_BRANDS` in `packages/shared/src/commandApps.ts`.
