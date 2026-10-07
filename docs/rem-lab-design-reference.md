# REM Lab layout reference — 2026-10-07

Primary reference: Neutra VDL Studio & Residences, designed by MOUTHWASH and developed by Jason Bradley.

- Award record: https://www.awwwards.com/sites/neutra-vdl — Site of the Day, 2022-07-29, score 7.58.
- Original: https://neutra-vdl.org/
- Official reference capture inspected: https://assets.awwwards.com/awards/sites_of_the_day/2022/07/vdl-interior-1.jpg
- Source HTML inspected for layout proportions; local scratch copy `/tmp/neutra-reference.html` is not shipped.

Observed layout: four distributed headline groups, twelve-column alignment, thin rules, compact metadata, asymmetrical body placement, large photographic plates, numbered navigation and a dark contents view. The live original page timed out in the browser; its official award screenshot and server-rendered source were available.

Implementation: translate this structure to REM Lab with a four-part masthead, three-column side index / nine-column research body, image plates and caption rules, a native dialog contents menu, and a dark recruitment section. Original website source, fonts, photos, branding, or prose are not included. REM Lab's existing local Inter/Noto fonts and confirmed illustrations are retained. Mobile uses a four-cell title, stacked content, and the dialog index; motion preferences are respected.

Scope: REM Lab detail page, its dedicated CSS and JS only. Homepage untouched. No new third-party runtime or remote assets.
