#!/usr/bin/env python3
"""Standalone PNG contour prototype for Deepnest.

Generates simple SVGs from PNG inputs in two modes:
- bounds: rectangle matching full image bounds
- silhouette: traced outer contour from alpha/background segmentation

This script is intentionally external to the app so we can judge output quality
before wiring anything into the import pipeline.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

import contourpy
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


Point = Tuple[float, float]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prototype PNG contour extraction to SVG.")
    parser.add_argument("inputs", nargs="+", help="PNG files to process")
    parser.add_argument("--output-dir", default="ml/artifacts/png-trace-test", help="Directory for SVG outputs")
    parser.add_argument("--alpha-threshold", type=int, default=16, help="Alpha cutoff for transparent images")
    parser.add_argument("--background-threshold", type=int, default=20, help="RGB distance from corner background color")
    parser.add_argument("--min-area", type=int, default=200, help="Minimum connected-component area to keep")
    parser.add_argument("--simplify", type=float, default=1.5, help="RDP simplification epsilon in pixels")
    return parser.parse_args()


def rdp(points: Sequence[Point], epsilon: float) -> List[Point]:
    if len(points) < 3:
        return list(points)

    start = np.array(points[0], dtype=float)
    end = np.array(points[-1], dtype=float)
    seg = end - start
    seg_norm = np.linalg.norm(seg)
    if seg_norm == 0:
        distances = [np.linalg.norm(np.array(p, dtype=float) - start) for p in points[1:-1]]
    else:
        distances = []
        for p in points[1:-1]:
            vec = np.array(p, dtype=float) - start
            proj = np.dot(vec, seg) / seg_norm
            proj_point = start + (proj / seg_norm) * seg
            distances.append(np.linalg.norm(np.array(p, dtype=float) - proj_point))

    if not distances:
        return [points[0], points[-1]]

    max_distance = max(distances)
    index = distances.index(max_distance) + 1
    if max_distance <= epsilon:
        return [points[0], points[-1]]

    left = rdp(points[: index + 1], epsilon)
    right = rdp(points[index:], epsilon)
    return left[:-1] + right


def polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def component_cleanup(mask: np.ndarray, min_area: int) -> np.ndarray:
    labeled, count = ndimage.label(mask)
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labeled, range(1, count + 1))
    cleaned = np.zeros_like(mask, dtype=bool)
    for label_index, size in enumerate(sizes, start=1):
        if size >= min_area:
            cleaned |= labeled == label_index
    return cleaned


def mask_from_image(image: Image.Image, alpha_threshold: int, background_threshold: int) -> np.ndarray:
    rgba = image.convert("RGBA")
    arr = np.array(rgba)
    alpha = arr[:, :, 3]

    if np.any(alpha < 250):
        mask = alpha >= alpha_threshold
    else:
        rgb = arr[:, :, :3].astype(np.int16)
        h, w = alpha.shape
        corners = np.array([
            rgb[0, 0],
            rgb[0, w - 1],
            rgb[h - 1, 0],
            rgb[h - 1, w - 1],
        ], dtype=np.int16)
        background = np.median(corners, axis=0)
        distance = np.sqrt(np.sum((rgb - background) ** 2, axis=2))
        mask = distance >= background_threshold

    # Smooth away isolated raster noise before contour extraction.
    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3), dtype=bool))
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5), dtype=bool))
    mask = ndimage.binary_fill_holes(mask)
    return mask


def extract_outer_contours(mask: np.ndarray, simplify_epsilon: float, min_area: int) -> List[List[Point]]:
    cleaned = component_cleanup(mask, min_area)
    if not np.any(cleaned):
      return []

    generator = contourpy.contour_generator(
        z=cleaned.astype(np.float64),
        line_type=contourpy.LineType.Separate,
        quad_as_tri=False,
    )
    lines = generator.lines(0.5)
    polygons: List[List[Point]] = []
    for line in lines:
        if len(line) < 4:
            continue

        pts = [(float(x), float(y)) for x, y in line]
        if pts[0] != pts[-1]:
            pts.append(pts[0])

        simplified = rdp(pts, simplify_epsilon)
        if len(simplified) < 4:
            continue
        if simplified[0] != simplified[-1]:
            simplified.append(simplified[0])

        area = abs(polygon_area(simplified[:-1]))
        if area < float(min_area):
            continue

        # contourpy returns both hole and outer rings; keep only outer shells.
        if polygon_area(simplified[:-1]) > 0:
            simplified = list(reversed(simplified))
        polygons.append(simplified)

    polygons.sort(key=lambda pts: abs(polygon_area(pts[:-1])), reverse=True)
    return polygons


def svg_header(width: int, height: int) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
    )


def path_d(points: Sequence[Point]) -> str:
    coords = [f"{points[0][0]:.2f},{points[0][1]:.2f}"]
    for x, y in points[1:]:
        coords.append(f"{x:.2f},{y:.2f}")
    return "M " + " L ".join(coords) + " Z"


def write_bounds_svg(image: Image.Image, output_path: Path) -> None:
    width, height = image.size
    svg = "\n".join(
        [
            svg_header(width, height),
            f'<rect x="0" y="0" width="{width}" height="{height}" fill="none" stroke="#111" stroke-width="1"/>',
            "</svg>",
        ]
    )
    output_path.write_text(svg, encoding="utf-8")


def write_silhouette_svg(image: Image.Image, contours: Sequence[Sequence[Point]], output_path: Path) -> None:
    width, height = image.size
    paths = []
    for contour in contours:
        if len(contour) < 4:
            continue
        paths.append(f'<path d="{path_d(contour[:-1])}" fill="none" stroke="#111" stroke-width="1"/>')

    svg = "\n".join([svg_header(width, height)] + paths + ["</svg>"])
    output_path.write_text(svg, encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for input_name in args.inputs:
        input_path = Path(input_name).expanduser().resolve()
        image = Image.open(input_path).convert("RGBA")

        base = input_path.stem
        bounds_path = output_dir / f"{base}--bounds.svg"
        silhouette_path = output_dir / f"{base}--silhouette.svg"

        write_bounds_svg(image, bounds_path)

        mask = mask_from_image(image, args.alpha_threshold, args.background_threshold)
        contours = extract_outer_contours(mask, args.simplify, args.min_area)
        write_silhouette_svg(image, contours[:1], silhouette_path)

        print(f"{input_path.name}: wrote {bounds_path.name} and {silhouette_path.name} ({len(contours)} contour(s) found)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
