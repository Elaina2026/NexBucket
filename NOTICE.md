# Notices

## NexBucket Minecraft banner integration

The files under `src/status/mc-banner/`, `src/status/minecraftBanner.js`, and
`scripts/prepare-mc-banner-assets.cjs` are adapted from the author's
`mc-server-banner-api` Node.js renderer and are used in NexBucket under a
separate dual-license permission granted by the author for this project.
That permission does not change NexBucket's project-wide license.

The renderer was originally developed from `LOOHP/MC-Server-Banner-API`.
Copyright remains with its contributors; the original project is licensed
under GNU GPL v3.0. See the source project's notice and license for details.

Minecraft font definitions, font atlas textures, and ping sprites are
downloaded at deployment time from Mojang's official asset service and are
not bundled in this repository. Minecraft and Mojang are trademarks of
Microsoft. NexBucket is not affiliated with or endorsed by Microsoft or
Mojang.

Third-party dependencies retain their own licenses, including
`@napi-rs/canvas` and `yauzl`.
