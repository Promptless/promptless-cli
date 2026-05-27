#!/usr/bin/env nu
# export logo svgs to png and webp
# png: rsvg-convert renders, magick strips and crushes
# webp: cwebp does lossy with sharp chroma subsampling

const self_path = path self
let dir = dirname $self_path | path join "../assets" | path expand

for variant in ["logo-text-v1" "logo-text-v1-dark"] {
    let src = ($dir | path join $"($variant).svg")
    let png = ($dir | path join $"($variant).png")
    let webp = ($dir | path join $"($variant).webp")

    rsvg-convert -w 1200 $src -o $png
    magick $png -strip -define png:compression-level=9 -define png:compression-filter=5 $png
    cwebp -q 80 -m 6 -af -sharp_yuv $png -o $webp

    let png_size = (ls $png | get size.0)
    let webp_size = (ls $webp | get size.0)
    print $"($variant)\tpng: ($png_size)\twebp: ($webp_size)"
}

# square logo at common icon sizes
let square_src = ($dir | path join "logo-square.svg")
for size in [32 64 128 256 512] {
    let png = ($dir | path join $"logo-square-($size).png")
    rsvg-convert -w $size -h $size $square_src -o $png
    magick $png -strip -define png:compression-level=9 -define png:compression-filter=5 $png
    let png_size = (ls $png | get size.0)
    print $"logo-square-($size)\tpng: ($png_size)"
}
