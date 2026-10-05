#!/bin/sh
# Render the PWA icons from the Dayrule mark (needs rsvg-convert, from
# librsvg). Production: ink ring on paper. Preview: paper ring on ink, so
# the two installed apps can't be confused (PLAN.md §14).
set -eu
cd "$(dirname "$0")/../public/icons"

mark() { # $1 ring colour
  printf '<circle cx="256" cy="256" r="150" fill="none" stroke="%s" stroke-width="36"/>' "$1"
  printf '<path d="M184 264l52 52 96-112" fill="none" stroke="#c2502e" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>'
}

render() { # $1 suffix, $2 background, $3 ring
  open='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
  # Rounded, for browsers that show the icon as is.
  printf '%s<rect width="512" height="512" rx="112" fill="%s"/>%s</svg>' "$open" "$2" "$(mark "$3")" > "icon$1.svg"
  # Full bleed, for maskable icons and iOS (the mark sits in the safe zone).
  printf '%s<rect width="512" height="512" fill="%s"/>%s</svg>' "$open" "$2" "$(mark "$3")" > "maskable$1.svg"
  rsvg-convert -w 192 -h 192 "icon$1.svg" -o "icon$1-192.png"
  rsvg-convert -w 512 -h 512 "icon$1.svg" -o "icon$1-512.png"
  rsvg-convert -w 512 -h 512 "maskable$1.svg" -o "maskable$1-512.png"
  rsvg-convert -w 180 -h 180 "maskable$1.svg" -o "apple-touch-icon$1.png"
  rm "icon$1.svg" "maskable$1.svg"
}

render '' '#f7f3ec' '#1f1b16'
render '-preview' '#1f1b16' '#f7f3ec'
