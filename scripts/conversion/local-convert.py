#!/usr/bin/env python3
"""Local conversion backend for Deepnest local import/export workflows.

Modes:
- doctor: checks required Python modules
- pdf-to-svg: first page PDF -> SVG with text outlined and masked images precomposed
- svg-to-pdf: SVG -> single page PDF
- png/jpg/jpeg-to-svg: bitmap -> SVG with embedded artwork and either a rectangle
  contour or a traced outer silhouette
"""

from __future__ import annotations

import argparse
import base64
import copy
import io
import json
import math
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from typing import List, Sequence, Tuple

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)
Point = Tuple[float, float]


def _load_module(name: str):
    try:
        module = __import__(name)
        return module, None
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        return None, str(exc)


def run_doctor() -> int:
    fitz, fitz_err = _load_module("fitz")
    pil_image = None
    pil_chops = None
    pil_err = None
    try:
        from PIL import Image, ImageChops  # type: ignore

        pil_image = Image
        pil_chops = ImageChops
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        pil_err = str(exc)

    numpy_mod, numpy_err = _load_module("numpy")
    scipy_mod = None
    contourpy_mod = None
    scipy_err = None
    contourpy_err = None
    try:
        from scipy import ndimage  # type: ignore

        scipy_mod = ndimage
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        scipy_err = str(exc)

    try:
        import contourpy  # type: ignore

        contourpy_mod = contourpy
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        contourpy_err = str(exc)

    mode_support = {
        "pdf-to-svg": fitz is not None and pil_image is not None and pil_chops is not None,
        "svg-to-pdf": fitz is not None,
        "png-to-svg": pil_image is not None and numpy_mod is not None and scipy_mod is not None and contourpy_mod is not None,
        "jpg-to-svg": pil_image is not None and numpy_mod is not None and scipy_mod is not None and contourpy_mod is not None,
        "jpeg-to-svg": pil_image is not None and numpy_mod is not None and scipy_mod is not None and contourpy_mod is not None,
    }
    ready = any(mode_support.values())
    report = {
        "ready": ready,
        "modes": mode_support,
        "requirements": {
            "pymupdf": fitz is not None,
            "pillow": pil_image is not None,
            "numpy": numpy_mod is not None,
            "scipy": scipy_mod is not None,
            "contourpy": contourpy_mod is not None,
        },
        "errors": {
            "pymupdf": fitz_err,
            "pillow": pil_err,
            "numpy": numpy_err,
            "scipy": scipy_err,
            "contourpy": contourpy_err,
        },
        "hint": "Install with: python3 -m pip install --user pymupdf pillow numpy scipy contourpy",
    }
    print(json.dumps(report))
    return 0 if ready else 2


def _parse_data_uri(uri: str):
    if not uri:
        return None, None
    m = re.match(r"^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$", uri, re.IGNORECASE | re.DOTALL)
    if not m:
        return None, None

    mime = m.group(1) or "application/octet-stream"
    body = m.group(3) or ""
    if m.group(2):
        clean = re.sub(r"\s+", "", body)
        return mime, base64.b64decode(clean)
    return mime, urllib.parse.unquote_to_bytes(body)


def _to_png_data_uri(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _get_href(node: ET.Element):
    return node.get(f"{{{XLINK_NS}}}href") or node.get("href")


def _set_href(node: ET.Element, value: str):
    node.set(f"{{{XLINK_NS}}}href", value)
    if "href" in node.attrib:
        del node.attrib["href"]


def _url_ref_id(value: str):
    if not value:
        return None
    m = re.match(r"^url\(#([^\)]+)\)$", value.strip())
    if not m:
        return None
    return m.group(1)


def _flatten_masked_images(svg_text: str, strip_clip_paths: bool = True):
    from PIL import Image, ImageChops  # type: ignore

    root = ET.fromstring(svg_text)

    masks_by_id = {}
    for mask in root.findall(f".//{{{SVG_NS}}}mask"):
        mid = mask.get("id")
        if mid:
            masks_by_id[mid] = mask

    converted_mask_ids = set()

    for node in root.iter():
        mask_attr = node.get("mask")
        mask_id = _url_ref_id(mask_attr)
        if not mask_id:
            continue
        mask_node = masks_by_id.get(mask_id)
        if mask_node is None:
            continue

        if node.tag == f"{{{SVG_NS}}}image":
            target_image = node
        else:
            target_image = node.find(f".//{{{SVG_NS}}}image")
            if target_image is None:
                continue

        mask_image = mask_node.find(f".//{{{SVG_NS}}}image")
        if mask_image is None:
            continue

        color_href = _get_href(target_image)
        mask_href = _get_href(mask_image)
        _, color_bytes = _parse_data_uri(color_href)
        _, mask_bytes = _parse_data_uri(mask_href)
        if not color_bytes or not mask_bytes:
            continue

        color = Image.open(io.BytesIO(color_bytes)).convert("RGBA")
        gray = Image.open(io.BytesIO(mask_bytes)).convert("L")

        if gray.size != color.size:
            if hasattr(Image, "Resampling"):
                gray = gray.resize(color.size, Image.Resampling.LANCZOS)
            else:
                gray = gray.resize(color.size, Image.LANCZOS)

        alpha = color.getchannel("A")
        merged_alpha = ImageChops.multiply(alpha, gray)
        color.putalpha(merged_alpha)

        out = io.BytesIO()
        color.save(out, format="PNG", optimize=True)

        _set_href(target_image, _to_png_data_uri(out.getvalue()))
        if "mask" in node.attrib:
            del node.attrib["mask"]
        converted_mask_ids.add(mask_id)

    if strip_clip_paths:
        for node in root.iter():
            if "clip-path" in node.attrib:
                del node.attrib["clip-path"]

    if converted_mask_ids:
        for defs in root.findall(f".//{{{SVG_NS}}}defs"):
            for child in list(defs):
                if child.tag == f"{{{SVG_NS}}}mask" and child.get("id") in converted_mask_ids:
                    defs.remove(child)

    return ET.tostring(root, encoding="unicode")


def _xml_deepcopy(element: ET.Element):
    return ET.fromstring(ET.tostring(element, encoding="unicode"))


def _is_descendant_of(node: ET.Element, ancestor_tag_names: Sequence[str], parent_map):
    current = parent_map.get(node)
    while current is not None:
        if current.tag.split("}")[-1] in ancestor_tag_names:
            return True
        current = parent_map.get(current)
    return False


def _find_ancestor_with_attribute(node: ET.Element, attribute_name: str, parent_map):
    current = node
    while current is not None:
        if current.get(attribute_name):
            return current
        current = parent_map.get(current)
    return None


def _parse_root_viewbox(root: ET.Element):
    raw = root.get("viewBox")
    if raw:
        parts = [float(x) for x in raw.replace(",", " ").split()]
        if len(parts) == 4:
            return parts

    width = float(root.get("width", "0") or "0")
    height = float(root.get("height", "0") or "0")
    return [0.0, 0.0, width, height]


def _tag_name(node: ET.Element):
    return node.tag.split("}")[-1]


def _is_closed_vector_shape(node: ET.Element):
    tag = _tag_name(node)
    if tag in {"polygon", "rect", "circle", "ellipse"}:
        return True
    if tag == "path":
        d = node.get("d") or ""
        if re.search(r"[zZ]", d):
            return True
        fill = (node.get("fill") or "").strip().lower()
        return bool(fill and fill != "none")
    return False


def _transform_chain(node: ET.Element, parent_map):
    transforms = []
    current = node
    while current is not None:
        value = (current.get("transform") or "").strip()
        if value:
            transforms.append(value)
        current = parent_map.get(current)
    transforms.reverse()
    return transforms


def _top_level_node_copy(node: ET.Element, parent_map):
    lifted = _xml_deepcopy(node)
    transforms = _transform_chain(node, parent_map)
    if transforms:
        lifted.set("transform", " ".join(transforms))
    elif "transform" in lifted.attrib:
        del lifted.attrib["transform"]

    for attr in ("clip-path", "mask", "opacity"):
        if attr in lifted.attrib:
            del lifted.attrib[attr]

    return lifted


def _build_isolated_svg(root: ET.Element, viewbox, node: ET.Element, parent_map, include_defs: bool = False):
    page_width = viewbox[2]
    page_height = viewbox[3]
    out_root = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "width": f"{page_width}",
            "height": f"{page_height}",
            "viewBox": f"{viewbox[0]} {viewbox[1]} {viewbox[2]} {viewbox[3]}",
        },
    )

    if include_defs:
        defs = root.find(f"./{{{SVG_NS}}}defs")
        if defs is not None:
            out_root.append(_xml_deepcopy(defs))

    chain = []
    current = node
    while current is not None and _tag_name(current) != "svg":
        if _tag_name(current) != "defs":
            chain.append(current)
        current = parent_map.get(current)
    chain.reverse()

    parent_out = out_root
    for index, original in enumerate(chain):
        if index == len(chain) - 1:
            clone = _xml_deepcopy(original)
        else:
            clone = ET.Element(original.tag, dict(original.attrib))
        parent_out.append(clone)
        parent_out = clone

    return out_root


def _render_node_bbox(root: ET.Element, viewbox, node: ET.Element, parent_map, fitz_module, scale: float, include_defs: bool = False):
    render_root = _build_isolated_svg(root, viewbox, node, parent_map, include_defs=include_defs)
    render = _render_svg_to_rgba(ET.tostring(render_root, encoding="unicode"), fitz_module, scale=scale)
    return _alpha_bbox(render)


def _render_node_rgba(root: ET.Element, viewbox, node: ET.Element, parent_map, fitz_module, scale: float, include_defs: bool = False):
    render_root = _build_isolated_svg(root, viewbox, node, parent_map, include_defs=include_defs)
    return _render_svg_to_rgba(ET.tostring(render_root, encoding="unicode"), fitz_module, scale=scale)


def _render_top_level_shape_bbox(viewbox, node: ET.Element, fitz_module, scale: float):
    page_width = viewbox[2]
    page_height = viewbox[3]
    render_root = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "width": f"{page_width}",
            "height": f"{page_height}",
            "viewBox": f"{viewbox[0]} {viewbox[1]} {viewbox[2]} {viewbox[3]}",
        },
    )
    render_node = _xml_deepcopy(node)
    render_node.set("fill", "#000000")
    render_node.set("stroke", "none")
    render_root.append(render_node)
    render = _render_svg_to_rgba(ET.tostring(render_root, encoding="unicode"), fitz_module, scale=scale)
    return _alpha_bbox(render)


def _bbox_area(bbox):
    if not bbox:
        return 0
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def _bbox_intersection(a, b):
    if not a or not b:
        return None
    left = max(a[0], b[0])
    top = max(a[1], b[1])
    right = min(a[2], b[2])
    bottom = min(a[3], b[3])
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


def _bbox_contains(outer, inner, tolerance: float = 0.0):
    if not outer or not inner:
        return False
    return (
        outer[0] <= inner[0] + tolerance
        and outer[1] <= inner[1] + tolerance
        and outer[2] >= inner[2] - tolerance
        and outer[3] >= inner[3] - tolerance
    )


def _bbox_match_score(outer, inner):
    if not outer or not inner:
        return None
    if not _bbox_contains(outer, inner, tolerance=8.0):
        return None

    inner_area = max(1, _bbox_area(inner))
    outer_area = _bbox_area(outer)
    intersection = _bbox_intersection(outer, inner)
    overlap = (_bbox_area(intersection) / inner_area) if intersection else 0.0
    expansion = outer_area / inner_area
    if overlap < 0.85:
        return None
    if expansion > 6.0:
        return None

    return (outer_area, expansion)


def _candidate_signature(node: ET.Element):
    tag = _tag_name(node)
    return (
        tag,
        node.get("d") or "",
        node.get("points") or "",
        node.get("x") or "",
        node.get("y") or "",
        node.get("width") or "",
        node.get("height") or "",
        node.get("cx") or "",
        node.get("cy") or "",
        node.get("rx") or "",
        node.get("ry") or "",
        node.get("r") or "",
        node.get("transform") or "",
    )


def _node_is_filled(node: ET.Element):
    fill = (node.get("fill") or "").strip().lower()
    return bool(fill and fill != "none")


def _visible_vector_candidates(root: ET.Element, viewbox, parent_map, fitz_module, scale: float):
    candidates_by_signature = {}
    for node in root.iter():
        if not _is_closed_vector_shape(node):
            continue
        if _is_descendant_of(node, ("defs", "mask", "clipPath"), parent_map):
            continue

        lifted = _top_level_node_copy(node, parent_map)
        bbox = _render_top_level_shape_bbox(viewbox, lifted, fitz_module, scale)
        if not bbox:
            continue

        signature = _candidate_signature(lifted)
        candidate = {
            "node": lifted,
            "bbox": bbox,
            "filled": _node_is_filled(node),
        }

        # Track actual ancestry for scope matching, but ignore defs/masks/clip paths.
        current = node
        scope_ids = set()
        while current is not None:
            current = parent_map.get(current)
            if current is None:
                break
            tag = _tag_name(current)
            if tag in {"svg", "defs", "mask", "clipPath"}:
                continue
            scope_ids.add(id(current))
        candidate["scope_ids"] = scope_ids

        existing = candidates_by_signature.get(signature)
        if existing is None or (candidate["filled"] and not existing["filled"]):
            candidates_by_signature[signature] = candidate

    return list(candidates_by_signature.values())


def _match_best_candidate(image_bbox, candidates, require_scope: set[int] | None = None):
    ranked = []
    for candidate in candidates:
        if require_scope is not None and not (candidate["scope_ids"] & require_scope):
            continue
        score = _bbox_match_score(candidate["bbox"], image_bbox)
        if score is None:
            continue
        ranked.append((score, candidate))

    if not ranked:
        return None

    ranked.sort(key=lambda item: item[0])
    best_score, best_candidate = ranked[0]
    if len(ranked) > 1:
        next_score = ranked[1][0]
        if next_score[0] <= best_score[0] * 1.03:
            return None

    return best_candidate


def _render_svg_to_rgba(svg_text: str, fitz_module, scale: float = 4.0):
    from PIL import Image  # type: ignore

    svg_doc = fitz_module.open(stream=svg_text.encode("utf-8"), filetype="svg")
    try:
        pix = svg_doc[0].get_pixmap(matrix=fitz_module.Matrix(scale, scale), alpha=True)
        image = Image.frombytes("RGBA", [pix.width, pix.height], pix.samples)
        return image
    finally:
        svg_doc.close()


def _alpha_bbox(image):
    alpha = image.getchannel("A")
    return alpha.getbbox()


def _pdf_visible_images(root: ET.Element):
    images = []
    parent_map = {child: parent for parent in root.iter() for child in parent}
    for image in root.iter():
        if image.tag != f"{{{SVG_NS}}}image":
            continue
        if _is_descendant_of(image, ("defs", "mask", "clipPath"), parent_map):
            continue
        images.append((image, parent_map))
    return images


def _build_pdf_composite_svg(page, svg_text: str, fitz_module):
    from PIL import Image  # type: ignore

    root = ET.fromstring(svg_text)
    parent_map = {child: parent for parent in root.iter() for child in parent}
    viewbox = _parse_root_viewbox(root)
    page_width = viewbox[2]
    page_height = viewbox[3]
    defs = root.find(f"./{{{SVG_NS}}}defs")
    clip_paths = {}
    if defs is not None:
        for clip_path in defs.findall(f"./{{{SVG_NS}}}clipPath"):
            clip_id = clip_path.get("id")
            if clip_id:
                clip_paths[clip_id] = clip_path

    visible_images = []
    for image in root.iter(f"{{{SVG_NS}}}image"):
        if _is_descendant_of(image, ("defs", "mask", "clipPath"), parent_map):
            continue
        visible_images.append(image)

    if not visible_images:
        return None

    render_scale = 4.0

    visible_candidates = _visible_vector_candidates(root, viewbox, parent_map, fitz_module, render_scale)
    composite_items = []
    for image in visible_images:
        artwork_render = _render_node_rgba(root, viewbox, image, parent_map, fitz_module, render_scale, include_defs=True)
        image_bbox = _alpha_bbox(artwork_render)
        if not image_bbox:
            continue

        scope_ids = set()
        current = image
        while current is not None:
            current = parent_map.get(current)
            if current is None:
                break
            tag = _tag_name(current)
            if tag in {"svg", "defs", "mask", "clipPath"}:
                continue
            scope_ids.add(id(current))

        clip_candidates = []
        clip_owner = _find_ancestor_with_attribute(image, "clip-path", parent_map)
        if clip_owner is not None:
            clip_id = _url_ref_id(clip_owner.get("clip-path"))
            clip_path = clip_paths.get(clip_id) if clip_id else None
            if clip_path is not None:
                for child in list(clip_path):
                    if not _is_closed_vector_shape(child):
                        continue
                    lifted = _top_level_node_copy(child, parent_map)
                    bbox = _render_top_level_shape_bbox(viewbox, lifted, fitz_module, render_scale)
                    if not bbox:
                        continue
                    clip_candidates.append(
                        {
                            "node": lifted,
                            "bbox": bbox,
                            "filled": True,
                            "scope_ids": scope_ids,
                        }
                    )

        clip_candidate = _match_best_candidate(image_bbox, clip_candidates, require_scope=None)
        contour_candidate = None
        if clip_candidate is not None:
            visible_from_scope = []
            for candidate in visible_candidates:
                if not (candidate["scope_ids"] & scope_ids):
                    continue
                if _bbox_match_score(candidate["bbox"], image_bbox) is None:
                    continue
                if not _bbox_contains(candidate["bbox"], clip_candidate["bbox"], tolerance=12.0):
                    continue
                visible_from_scope.append(candidate)
            contour_candidate = _match_best_candidate(image_bbox, visible_from_scope, require_scope=None) or clip_candidate

        if contour_candidate is None:
            contour_candidate = _match_best_candidate(image_bbox, visible_candidates, require_scope=scope_ids)
        if contour_candidate is None:
            contour_candidate = _match_best_candidate(image_bbox, visible_candidates, require_scope=None)
        if contour_candidate is None:
            continue

        bbox = contour_candidate["bbox"]
        margin = max(2, int(math.ceil(render_scale * 1.5)))
        left = max(0, bbox[0] - margin)
        top = max(0, bbox[1] - margin)
        right = min(artwork_render.width, bbox[2] + margin)
        bottom = min(artwork_render.height, bbox[3] + margin)
        if right <= left or bottom <= top:
            continue

        cropped = artwork_render.crop((left, top, right, bottom))
        if not _alpha_bbox(cropped):
            continue

        buffer = io.BytesIO()
        cropped.save(buffer, format="PNG", optimize=True)

        x = viewbox[0] + (left / render_scale)
        y = viewbox[1] + (top / render_scale)
        width = (right - left) / render_scale
        height = (bottom - top) / render_scale
        composite_items.append(
            {
                "image_png": buffer.getvalue(),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "contour": contour_candidate["node"],
            }
        )

    if not composite_items:
        return None

    out_root = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "width": f"{page_width}",
            "height": f"{page_height}",
            "viewBox": f"{viewbox[0]} {viewbox[1]} {viewbox[2]} {viewbox[3]}",
            "data-deepnest-pdf-composite": "true",
        },
    )

    for item in composite_items:
        image_node = ET.SubElement(
            out_root,
            f"{{{SVG_NS}}}image",
            {
                "x": f"{item['x']:.4f}",
                "y": f"{item['y']:.4f}",
                "width": f"{item['width']:.4f}",
                "height": f"{item['height']:.4f}",
                "preserveAspectRatio": "none",
                "data-deepnest-bitmap-mode": "pdf-composite",
            },
        )
        _set_href(image_node, _to_png_data_uri(item["image_png"]))

        contour = _xml_deepcopy(item["contour"])
        contour.set("fill", "none")
        contour.set("stroke", "#111111")
        contour.set("stroke-width", contour.get("stroke-width", "1"))
        contour.set("data-deepnest-contour", "true")
        out_root.append(contour)

    return ET.tostring(out_root, encoding="unicode")


def convert_pdf_to_svg(input_path: str, output_path: str, options_json: str | None = None):
    fitz, fitz_err = _load_module("fitz")
    if fitz is None:
        raise RuntimeError(f"PyMuPDF missing: {fitz_err}")

    options = {}
    if options_json:
        options = json.loads(options_json)

    doc = fitz.open(input_path)
    if len(doc) < 1:
        raise RuntimeError("input PDF has no pages")

    page = doc.load_page(0)
    raw_svg = page.get_svg_image(text_as_path=1)

    svg = None
    composite_requested = bool(options.get("compositeObjects"))
    if composite_requested:
        composite_svg = _build_pdf_composite_svg(page, _flatten_masked_images(raw_svg, strip_clip_paths=False), fitz)
        if composite_svg:
            svg = composite_svg

    if svg is None:
        svg = _flatten_masked_images(raw_svg)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg)


def convert_svg_to_pdf(input_path: str, output_path: str):
    fitz, fitz_err = _load_module("fitz")
    if fitz is None:
        raise RuntimeError(f"PyMuPDF missing: {fitz_err}")

    with open(input_path, "rb") as f:
        svg_bytes = f.read()

    doc = fitz.open(stream=svg_bytes, filetype="svg")
    pdf_bytes = doc.convert_to_pdf()

    with open(output_path, "wb") as f:
        f.write(pdf_bytes)


def _rdp(points: Sequence[Point], epsilon: float) -> List[Point]:
    if len(points) < 3:
        return list(points)

    import numpy as np  # type: ignore

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

    left = _rdp(points[: index + 1], epsilon)
    right = _rdp(points[index:], epsilon)
    return left[:-1] + right


def _polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def _component_cleanup(mask, min_area: int):
    from scipy import ndimage  # type: ignore
    import numpy as np  # type: ignore

    labeled, count = ndimage.label(mask)
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labeled, range(1, count + 1))
    cleaned = np.zeros_like(mask, dtype=bool)
    for label_index, size in enumerate(sizes, start=1):
        if size >= min_area:
            cleaned |= labeled == label_index
    return cleaned


def _clamp_float(value, minimum: float, maximum: float, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, numeric))


def _clamp_int(value, minimum: int, maximum: int, fallback: int) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, numeric))


def _detail_to_epsilon(detail: float) -> float:
    normalized = _clamp_float(detail, 0.0, 100.0, 80.0)
    return 0.08 + ((100.0 - normalized) / 100.0) * 1.6


def _smoothing_to_sigma(smoothing: float) -> float:
    normalized = _clamp_float(smoothing, 0.0, 100.0, 25.0)
    if normalized <= 0:
        return 0.0
    return (normalized / 100.0) * 0.9


def _corner_smoothness_to_iterations(corner_smoothness: float) -> int:
    normalized = _clamp_float(corner_smoothness, 0.0, 100.0, 0.0)
    if normalized <= 0:
        return 0
    return min(3, max(1, int(math.ceil(normalized / 34.0))))


def _disk_structure(radius: int):
    import numpy as np  # type: ignore

    radius = max(1, int(radius))
    y, x = np.ogrid[-radius : radius + 1, -radius : radius + 1]
    return (x * x + y * y) <= (radius * radius)


def _chaikin_closed(points: Sequence[Point], iterations: int) -> List[Point]:
    working = list(points)
    if not working or iterations <= 0:
        return working

    if working[0] == working[-1]:
        working = working[:-1]

    if len(working) < 3:
        closed = list(working)
        if closed and closed[0] != closed[-1]:
            closed.append(closed[0])
        return closed

    for _ in range(iterations):
        smoothed: List[Point] = []
        for index, point in enumerate(working):
            next_point = working[(index + 1) % len(working)]
            smoothed.append(
                (
                    point[0] * 0.75 + next_point[0] * 0.25,
                    point[1] * 0.75 + next_point[1] * 0.25,
                )
            )
            smoothed.append(
                (
                    point[0] * 0.25 + next_point[0] * 0.75,
                    point[1] * 0.25 + next_point[1] * 0.75,
                )
            )
        working = smoothed

    working.append(working[0])
    return working


def _turn_angle_magnitude(prev_point: Point, point: Point, next_point: Point) -> float:
    ax = point[0] - prev_point[0]
    ay = point[1] - prev_point[1]
    bx = next_point[0] - point[0]
    by = next_point[1] - point[1]

    len_a = math.hypot(ax, ay)
    len_b = math.hypot(bx, by)
    if len_a == 0 or len_b == 0:
        return 0.0

    ax /= len_a
    ay /= len_a
    bx /= len_b
    by /= len_b
    dot = max(-1.0, min(1.0, ax * bx + ay * by))
    return math.acos(dot)


def _closed_ring_anchor_index(points: Sequence[Point]) -> int:
    if len(points) < 3:
        return 0

    best_index = 0
    best_angle = -1.0
    for index in range(len(points)):
        prev_point = points[(index - 1) % len(points)]
        point = points[index]
        next_point = points[(index + 1) % len(points)]
        angle = _turn_angle_magnitude(prev_point, point, next_point)
        if angle > best_angle:
            best_angle = angle
            best_index = index
    return best_index


def _simplify_closed_ring(points: Sequence[Point], epsilon: float) -> List[Point]:
    working = list(points)
    if not working:
        return []

    if working[0] == working[-1]:
        working = working[:-1]

    if len(working) < 3 or epsilon <= 0:
        closed = list(working)
        if closed and closed[0] != closed[-1]:
            closed.append(closed[0])
        return closed

    anchor = _closed_ring_anchor_index(working)
    rotated = working[anchor:] + working[:anchor]
    rotated.append(rotated[0])
    simplified = _rdp(rotated, epsilon)
    if simplified and simplified[0] == simplified[-1]:
        simplified = simplified[:-1]

    if len(simplified) < 3:
        simplified = rotated[:-1]

    closed = list(simplified)
    if closed[0] != closed[-1]:
        closed.append(closed[0])
    return closed


def _alpha_signal_from_image(image, padding: int, smoothing: float):
    from scipy import ndimage  # type: ignore
    import numpy as np  # type: ignore

    rgba = image.convert("RGBA")
    alpha_signal = np.array(rgba, dtype=np.float32)[:, :, 3] / 255.0
    sigma = _smoothing_to_sigma(smoothing)
    if sigma > 0:
        alpha_signal = ndimage.gaussian_filter(alpha_signal, sigma=sigma)
    if padding > 0:
        alpha_signal = np.pad(alpha_signal, padding, mode="constant", constant_values=0.0)
    return np.clip(alpha_signal, 0.0, 1.0)


def _supersample_field(field, factor: int):
    from scipy import ndimage  # type: ignore
    import numpy as np  # type: ignore

    factor = max(1, int(factor))
    if factor == 1:
        return field.astype(np.float32)

    sampled = ndimage.zoom(field.astype(np.float32), zoom=factor, order=3)
    return np.clip(sampled, 0.0, 1.0)


def _extract_outer_contour_from_field(field, level: float, simplify_epsilon: float, min_area: int, corner_smoothness: float, scale: float):
    import contourpy  # type: ignore

    field_min = float(field.min())
    field_max = float(field.max())
    if field_max <= field_min:
        return None
    level = max(field_min + 1e-6, min(field_max - 1e-6, float(level)))
    generator = contourpy.contour_generator(
        z=field,
        x=[index / scale for index in range(field.shape[1])],
        y=[index / scale for index in range(field.shape[0])],
        line_type=contourpy.LineType.Separate,
        quad_as_tri=False,
    )
    lines = generator.lines(level)
    polygons: List[List[Point]] = []
    close_tolerance = max(0.25 / max(scale, 1.0), 1e-3)
    for line in lines:
        if len(line) < 4:
            continue

        pts = [(float(x), float(y)) for x, y in line]
        if math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) > close_tolerance:
            continue
        if pts[0] != pts[-1]:
            pts.append(pts[0])

        pts = _chaikin_closed(pts, _corner_smoothness_to_iterations(corner_smoothness))
        simplified = _simplify_closed_ring(pts, simplify_epsilon)
        if len(simplified) < 4:
            continue

        area = abs(_polygon_area(simplified[:-1]))
        if area < float(min_area):
            continue

        if _polygon_area(simplified[:-1]) > 0:
            simplified = list(reversed(simplified))
        polygons.append(simplified)

    if not polygons:
        return None
    polygons.sort(key=lambda pts: abs(_polygon_area(pts[:-1])), reverse=True)
    return polygons[0]


def _extract_outer_contour_from_sdf(alpha_signal, alpha_level: float, offset_px: float, simplify_epsilon: float, min_area: int, corner_smoothness: float, supersample: int):
    from scipy import ndimage  # type: ignore
    import numpy as np  # type: ignore

    support = alpha_signal >= alpha_level
    if not support.any():
        return None

    support_highres = _supersample_field(support.astype(np.float32), supersample) >= 0.5
    inside = ndimage.distance_transform_edt(support_highres)
    outside = ndimage.distance_transform_edt(~support_highres)
    signed_distance = outside - inside
    contour_level = _clamp_float(offset_px, -100.0, 100.0, 0.0) * supersample
    return _extract_outer_contour_from_field(
        signed_distance.astype(np.float32),
        contour_level,
        simplify_epsilon,
        min_area,
        corner_smoothness,
        float(supersample),
    )


def _mask_from_image(image, alpha_threshold: int, background_threshold: int, smoothing: float, padding: int):
    from scipy import ndimage  # type: ignore
    import numpy as np  # type: ignore

    rgba = image.convert("RGBA")
    arr = np.array(rgba)
    alpha = arr[:, :, 3]
    sigma = _smoothing_to_sigma(smoothing)

    if (alpha < 250).any():
        alpha_signal = alpha.astype(np.float32) / 255.0
        if sigma > 0:
            alpha_signal = ndimage.gaussian_filter(alpha_signal, sigma=sigma)
        mask = alpha_signal >= (_clamp_int(alpha_threshold, 1, 254, 32) / 255.0)
    else:
        rgb = arr[:, :, :3].astype(np.int16)
        height, width = alpha.shape
        corners = np.array([
            rgb[0, 0],
            rgb[0, width - 1],
            rgb[height - 1, 0],
            rgb[height - 1, width - 1],
        ], dtype=np.int16)
        background = np.median(corners, axis=0)
        distance = np.sqrt(np.sum((rgb - background) ** 2, axis=2))
        if sigma > 0:
            distance = ndimage.gaussian_filter(distance, sigma=sigma)
        mask = distance >= _clamp_int(background_threshold, 1, 255, 20)

    if padding > 0:
        mask = np.pad(mask, padding, mode="constant", constant_values=False)

    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3), dtype=bool))
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5), dtype=bool))
    mask = ndimage.binary_fill_holes(mask)
    return mask


def _offset_mask(mask, offset_px: float):
    from scipy import ndimage  # type: ignore

    if abs(offset_px) < 0.5:
        return mask

    radius = int(math.ceil(abs(offset_px)))
    structure = _disk_structure(radius)
    if offset_px > 0:
        return ndimage.binary_dilation(mask, structure=structure)
    return ndimage.binary_erosion(mask, structure=structure)


def _extract_outer_contour(mask, simplify_epsilon: float, min_area: int, corner_smoothness: float):
    import contourpy  # type: ignore

    cleaned = _component_cleanup(mask, min_area)
    if not cleaned.any():
        return None

    generator = contourpy.contour_generator(
        z=cleaned.astype(float),
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

        pts = _chaikin_closed(pts, _corner_smoothness_to_iterations(corner_smoothness))
        simplified = _rdp(pts, simplify_epsilon)
        if len(simplified) < 4:
            continue
        if simplified[0] != simplified[-1]:
            simplified.append(simplified[0])

        area = abs(_polygon_area(simplified[:-1]))
        if area < float(min_area):
            continue

        if _polygon_area(simplified[:-1]) > 0:
            simplified = list(reversed(simplified))
        polygons.append(simplified)

    if not polygons:
        return None
    polygons.sort(key=lambda pts: abs(_polygon_area(pts[:-1])), reverse=True)
    return polygons[0]


def _path_d(points: Sequence[Point]) -> str:
    coords = [f"{points[0][0]:.2f},{points[0][1]:.2f}"]
    for x, y in points[1:]:
        coords.append(f"{x:.2f},{y:.2f}")
    return "M " + " L ".join(coords) + " Z"


def _translate_points(points: Sequence[Point] | None, dx: float, dy: float):
    if points is None:
        return None
    return [(x + dx, y + dy) for x, y in points]


def _sanitize_dpi(value, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback

    if numeric < 36 or numeric > 1200:
        return fallback
    return numeric


def _resolve_bitmap_physical_size(image, width: int, height: int, options: dict):
    fallback_dpi = _sanitize_dpi(options.get("fallbackDpi", 96), 96.0)
    raw_dpi = image.info.get("dpi")

    dpi_x = fallback_dpi
    dpi_y = fallback_dpi
    dpi_source = "fallback"

    if isinstance(raw_dpi, (tuple, list)) and len(raw_dpi) >= 2:
        candidate_x = _sanitize_dpi(raw_dpi[0], fallback_dpi)
        candidate_y = _sanitize_dpi(raw_dpi[1], fallback_dpi)
        if candidate_x != fallback_dpi or candidate_y != fallback_dpi:
            dpi_x = candidate_x
            dpi_y = candidate_y
            dpi_source = "embedded"

    override_width = options.get("physicalWidthIn")
    override_height = options.get("physicalHeightIn")

    try:
        override_width_in = float(override_width) if override_width is not None else None
    except (TypeError, ValueError):
        override_width_in = None
    try:
        override_height_in = float(override_height) if override_height is not None else None
    except (TypeError, ValueError):
        override_height_in = None

    if override_width_in is not None and override_width_in > 0:
        width_in = override_width_in
        if override_height_in is not None and override_height_in > 0:
            height_in = override_height_in
        else:
            height_in = width_in * (height / float(width))
        dpi_source = "user-override"
    elif override_height_in is not None and override_height_in > 0:
        height_in = override_height_in
        width_in = height_in * (width / float(height))
        dpi_source = "user-override"
    else:
        width_in = width / dpi_x
        height_in = height / dpi_y

    return {
        "dpi_x": dpi_x,
        "dpi_y": dpi_y,
        "dpi_source": dpi_source,
        "width_in": width_in,
        "height_in": height_in,
    }


def _build_bitmap_svg(
    image_bytes: bytes,
    mime_type: str,
    canvas_width: int,
    canvas_height: int,
    image_width: int,
    image_height: int,
    image_x: int,
    image_y: int,
    contour_mode: str,
    contour_points,
    physical_size,
):
    data_uri = f"data:{mime_type};base64," + base64.b64encode(image_bytes).decode("ascii")
    image_attr = {
        "x": str(image_x),
        "y": str(image_y),
        "width": str(image_width),
        "height": str(image_height),
    }

    svg = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "width": f"{physical_size['width_in']:.6f}in",
            "height": f"{physical_size['height_in']:.6f}in",
            "viewBox": f"0 0 {canvas_width} {canvas_height}",
            "data-deepnest-physical-width-in": f"{physical_size['width_in']:.6f}",
            "data-deepnest-physical-height-in": f"{physical_size['height_in']:.6f}",
            "data-deepnest-dpi-x": f"{physical_size['dpi_x']:.6f}",
            "data-deepnest-dpi-y": f"{physical_size['dpi_y']:.6f}",
            "data-deepnest-dpi-source": physical_size["dpi_source"],
            "data-deepnest-contour-mode": contour_mode,
            "data-deepnest-contour-points": str(4 if contour_mode == "bounds" else max(0, len(contour_points) - 1)),
        },
    )
    image_node = ET.SubElement(svg, f"{{{SVG_NS}}}image", image_attr)
    _set_href(image_node, data_uri)
    image_node.set("preserveAspectRatio", "none")
    image_node.set("data-deepnest-bitmap-mode", contour_mode)

    if contour_mode == "bounds":
        ET.SubElement(
            svg,
            f"{{{SVG_NS}}}rect",
            {
                "x": str(image_x),
                "y": str(image_y),
                "width": str(image_width),
                "height": str(image_height),
                "fill": "none",
                "stroke": "#111111",
                "stroke-width": "1",
                "data-deepnest-contour": "true",
            },
        )
    else:
        ET.SubElement(
            svg,
            f"{{{SVG_NS}}}path",
            {
                "d": _path_d(contour_points[:-1]),
                "fill": "none",
                "stroke": "#111111",
                "stroke-width": "1",
                "data-deepnest-contour": "true",
            },
        )

    return ET.tostring(svg, encoding="unicode")


def convert_bitmap_to_svg(input_path: str, output_path: str, mode_name: str, options_json: str | None):
    from PIL import Image  # type: ignore

    options = {}
    if options_json:
        options = json.loads(options_json)

    contour_mode = str(options.get("mode") or "bounds").strip().lower()
    if contour_mode not in {"bounds", "silhouette"}:
        contour_mode = "bounds"

    alpha_threshold = _clamp_int(options.get("alphaThreshold", 32), 1, 254, 32)
    background_threshold = _clamp_int(options.get("backgroundThreshold", 20), 1, 255, 20)
    min_area = _clamp_int(options.get("minArea", 80), 0, 1000000, 80)
    detail = _clamp_float(options.get("detail", 80), 0.0, 100.0, 80.0)
    smoothing = _clamp_float(options.get("smoothing", 25), 0.0, 100.0, 25.0)
    corner_smoothness = _clamp_float(options.get("cornerSmoothness", 0), 0.0, 100.0, 0.0)
    offset_px = _clamp_float(options.get("offsetPx", 0), -100.0, 100.0, 0.0)
    simplify_epsilon = float(options.get("simplify", _detail_to_epsilon(detail)))
    output_padding = int(math.ceil(max(0.0, offset_px))) + 2 if contour_mode == "silhouette" and offset_px > 0 else 0
    contour_padding = output_padding + (4 if contour_mode == "silhouette" else 0)
    supersample = _clamp_int(options.get("supersample", 4), 1, 8, 4)

    with open(input_path, "rb") as file_handle:
        image_bytes = file_handle.read()

    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    width, height = image.size
    canvas_width = width + (output_padding * 2)
    canvas_height = height + (output_padding * 2)
    physical_size = _resolve_bitmap_physical_size(image, canvas_width, canvas_height, options)

    if mode_name == "png-to-svg":
        mime_type = "image/png"
    else:
        mime_type = "image/jpeg"

    contour_points = None
    if contour_mode == "silhouette":
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        if (alpha.getextrema() or (255, 255))[0] < 250:
            alpha_signal = _alpha_signal_from_image(image, contour_padding, smoothing)
            alpha_level = _clamp_int(alpha_threshold, 1, 254, 32) / 255.0
            if abs(offset_px) < 0.05:
                contour_points = _extract_outer_contour_from_field(
                    _supersample_field(alpha_signal, supersample),
                    alpha_level,
                    simplify_epsilon,
                    min_area,
                    corner_smoothness,
                    float(supersample),
                )
            else:
                contour_points = _extract_outer_contour_from_sdf(
                    alpha_signal,
                    alpha_level,
                    offset_px,
                    simplify_epsilon,
                    min_area,
                    corner_smoothness,
                    supersample,
                )
            contour_points = _translate_points(
                contour_points,
                -(contour_padding - output_padding),
                -(contour_padding - output_padding),
            )
        else:
            mask = _mask_from_image(image, alpha_threshold, background_threshold, smoothing, output_padding)
            mask = _component_cleanup(mask, min_area)
            mask = _offset_mask(mask, offset_px)
            mask = _component_cleanup(mask, min_area)
            contour_points = _extract_outer_contour(mask, simplify_epsilon, min_area, corner_smoothness)

        if contour_points is None:
            raise RuntimeError("bitmap tracing produced no usable contour")

    svg_text = _build_bitmap_svg(
        image_bytes,
        mime_type,
        canvas_width,
        canvas_height,
        width,
        height,
        output_padding,
        output_padding,
        contour_mode,
        contour_points,
        physical_size,
    )
    with open(output_path, "w", encoding="utf-8") as file_handle:
        file_handle.write(svg_text)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Deepnest local conversion helper")
    parser.add_argument("--mode", required=True, choices=["doctor", "pdf-to-svg", "svg-to-pdf", "png-to-svg", "jpg-to-svg", "jpeg-to-svg"])
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--options")
    args = parser.parse_args(argv)

    if args.mode == "doctor":
        return run_doctor()

    if not args.input or not args.output:
        print("--input and --output are required for conversion modes", file=sys.stderr)
        return 2

    try:
        if args.mode == "pdf-to-svg":
            convert_pdf_to_svg(args.input, args.output, args.options)
        elif args.mode == "svg-to-pdf":
            convert_svg_to_pdf(args.input, args.output)
        elif args.mode in {"png-to-svg", "jpg-to-svg", "jpeg-to-svg"}:
            convert_bitmap_to_svg(args.input, args.output, args.mode, args.options)
        else:  # pragma: no cover
            raise RuntimeError("unsupported mode")
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
