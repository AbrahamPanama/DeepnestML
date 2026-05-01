#include <nan.h>
#include "minkowski.h"

#include <iostream>
#include <boost/polygon/polygon.hpp>
#include <string>
#include <iostream>
#include <sstream>
#include <limits>

#undef min
#undef max

typedef boost::polygon::point_data<int> point;
typedef boost::polygon::polygon_set_data<int> polygon_set;
typedef boost::polygon::polygon_with_holes_data<int> polygon;
typedef std::pair<point, point> edge;
using namespace boost::polygon::operators;

static inline bool same_point(const point& a, const point& b) {
  return a.get(boost::polygon::HORIZONTAL) == b.get(boost::polygon::HORIZONTAL) &&
         a.get(boost::polygon::VERTICAL) == b.get(boost::polygon::VERTICAL);
}

static inline long long cross_product(const point& a, const point& b, const point& c) {
  long long abx = static_cast<long long>(b.get(boost::polygon::HORIZONTAL)) -
                  static_cast<long long>(a.get(boost::polygon::HORIZONTAL));
  long long aby = static_cast<long long>(b.get(boost::polygon::VERTICAL)) -
                  static_cast<long long>(a.get(boost::polygon::VERTICAL));
  long long acx = static_cast<long long>(c.get(boost::polygon::HORIZONTAL)) -
                  static_cast<long long>(a.get(boost::polygon::HORIZONTAL));
  long long acy = static_cast<long long>(c.get(boost::polygon::VERTICAL)) -
                  static_cast<long long>(a.get(boost::polygon::VERTICAL));
  return abx * acy - aby * acx;
}

static void sanitize_ring(std::vector<point>& pts) {
  if (pts.empty()) {
    return;
  }

  std::vector<point> deduped;
  deduped.reserve(pts.size());
  for (std::size_t i = 0; i < pts.size(); ++i) {
    if (deduped.empty() || !same_point(deduped.back(), pts[i])) {
      deduped.push_back(pts[i]);
    }
  }

  if (deduped.size() > 1 && same_point(deduped.front(), deduped.back())) {
    deduped.pop_back();
  }

  if (deduped.size() < 3) {
    pts.swap(deduped);
    return;
  }

  bool changed = true;
  while (changed && deduped.size() >= 3) {
    changed = false;
    std::vector<point> simplified;
    simplified.reserve(deduped.size());

    for (std::size_t i = 0; i < deduped.size(); ++i) {
      const point& prev = deduped[(i + deduped.size() - 1) % deduped.size()];
      const point& current = deduped[i];
      const point& next = deduped[(i + 1) % deduped.size()];

      if (cross_product(prev, current, next) == 0) {
        changed = true;
        continue;
      }

      simplified.push_back(current);
    }

    deduped.swap(simplified);
  }

  if (deduped.size() > 1 && same_point(deduped.front(), deduped.back())) {
    deduped.pop_back();
  }

  pts.swap(deduped);
}

static bool valid_ring(const std::vector<point>& pts) {
  if (pts.size() < 3) {
    return false;
  }

  long long area2 = 0;
  for (std::size_t i = 0, j = pts.size() - 1; i < pts.size(); j = i++) {
    area2 +=
      (static_cast<long long>(pts[j].get(boost::polygon::HORIZONTAL)) +
       static_cast<long long>(pts[i].get(boost::polygon::HORIZONTAL))) *
      (static_cast<long long>(pts[j].get(boost::polygon::VERTICAL)) -
       static_cast<long long>(pts[i].get(boost::polygon::VERTICAL)));
  }

  return area2 != 0;
}

void convolve_two_segments(std::vector<point>& figure, const edge& a, const edge& b) {
  using namespace boost::polygon;
  figure.clear();
  figure.push_back(point(a.first));
  figure.push_back(point(a.first));
  figure.push_back(point(a.second));
  figure.push_back(point(a.second));
  convolve(figure[0], b.second);
  convolve(figure[1], b.first);
  convolve(figure[2], b.first);
  convolve(figure[3], b.second);
}

template <typename itrT1, typename itrT2>
void convolve_two_point_sequences(polygon_set& result, itrT1 ab, itrT1 ae, itrT2 bb, itrT2 be) {
  using namespace boost::polygon;
  if (ab == ae || bb == be) {
    return;
  }
  point first_a = *ab;
  point prev_a = *ab;
  std::vector<point> vec;
  polygon poly;
  ++ab;
  for (; ab != ae; ++ab) {
    point first_b = *bb;
    point prev_b = *bb;
    itrT2 tmpb = bb;
    ++tmpb;
    for (; tmpb != be; ++tmpb) {
      convolve_two_segments(vec, std::make_pair(prev_b, *tmpb), std::make_pair(prev_a, *ab));
      set_points(poly, vec.begin(), vec.end());
      result.insert(poly);
      prev_b = *tmpb;
    }
    prev_a = *ab;
  }
}

template <typename itrT>
void convolve_point_sequence_with_polygons(polygon_set& result, itrT b, itrT e, const std::vector<polygon>& polygons) {
  using namespace boost::polygon;
  for (std::size_t i = 0; i < polygons.size(); ++i) {
    convolve_two_point_sequences(result, b, e, begin_points(polygons[i]), end_points(polygons[i]));
    for (polygon_with_holes_traits<polygon>::iterator_holes_type itrh = begin_holes(polygons[i]);
      itrh != end_holes(polygons[i]); ++itrh) {
      convolve_two_point_sequences(result, b, e, begin_points(*itrh), end_points(*itrh));
    }
  }
}

void convolve_two_polygon_sets(polygon_set& result, const polygon_set& a, const polygon_set& b) {
  using namespace boost::polygon;
  result.clear();
  std::vector<polygon> a_polygons;
  std::vector<polygon> b_polygons;
  a.get(a_polygons);
  b.get(b_polygons);
  for (std::size_t ai = 0; ai < a_polygons.size(); ++ai) {
    convolve_point_sequence_with_polygons(result, begin_points(a_polygons[ai]),
      end_points(a_polygons[ai]), b_polygons);
    for (polygon_with_holes_traits<polygon>::iterator_holes_type itrh = begin_holes(a_polygons[ai]);
      itrh != end_holes(a_polygons[ai]); ++itrh) {
      convolve_point_sequence_with_polygons(result, begin_points(*itrh),
        end_points(*itrh), b_polygons);
    }
    for (std::size_t bi = 0; bi < b_polygons.size(); ++bi) {
      polygon tmp_poly = a_polygons[ai];
      result.insert(convolve(tmp_poly, *(begin_points(b_polygons[bi]))));
      tmp_poly = b_polygons[bi];
      result.insert(convolve(tmp_poly, *(begin_points(a_polygons[ai]))));
    }
  }
}

double inputscale;

using v8::Local;
using v8::Array;
using v8::Isolate;
using v8::String;
using v8::Object;
using v8::Value;

using namespace boost::polygon;

static inline double GetNumberProp(Local<Object> obj, Local<String> key) {
  return Nan::To<double>(Nan::Get(obj, key).ToLocalChecked()).FromJust();
}

static inline Local<Object> GetObjectAt(Local<Array> arr, uint32_t index) {
  return Nan::To<Object>(Nan::Get(arr, index).ToLocalChecked()).ToLocalChecked();
}

static inline Local<Array> GetArrayAt(Local<Array> arr, uint32_t index) {
  return Nan::Get(arr, index).ToLocalChecked().As<Array>();
}

static inline Local<Array> GetArrayProp(Local<Object> obj, Local<String> key) {
  return Nan::Get(obj, key).ToLocalChecked().As<Array>();
}

NAN_METHOD(calculateNFP) {
  Isolate* isolate = info.GetIsolate();

  Local<String> keyA = Nan::New<String>("A").ToLocalChecked();
  Local<String> keyB = Nan::New<String>("B").ToLocalChecked();
  Local<String> keyX = Nan::New<String>("x").ToLocalChecked();
  Local<String> keyY = Nan::New<String>("y").ToLocalChecked();
  Local<String> keyChildren = Nan::New<String>("children").ToLocalChecked();

  Local<Object> group = Nan::To<Object>(info[0]).ToLocalChecked();
  Local<Array> A = GetArrayProp(group, keyA);
  Local<Array> B = GetArrayProp(group, keyB);

  polygon_set a, b, c;
  std::vector<polygon> polys;
  std::vector<point> pts;

  unsigned int len = A->Length();
  double Amaxx = 0;
  double Aminx = 0;
  double Amaxy = 0;
  double Aminy = 0;
  for (unsigned int i = 0; i < len; i++) {
    Local<Object> obj = GetObjectAt(A, i);
    double x = GetNumberProp(obj, keyX);
    double y = GetNumberProp(obj, keyY);
    Amaxx = (std::max)(Amaxx, x);
    Aminx = (std::min)(Aminx, x);
    Amaxy = (std::max)(Amaxy, y);
    Aminy = (std::min)(Aminy, y);
  }

  len = B->Length();
  double Bmaxx = 0;
  double Bminx = 0;
  double Bmaxy = 0;
  double Bminy = 0;
  for (unsigned int i = 0; i < len; i++) {
    Local<Object> obj = GetObjectAt(B, i);
    double x = GetNumberProp(obj, keyX);
    double y = GetNumberProp(obj, keyY);
    Bmaxx = (std::max)(Bmaxx, x);
    Bminx = (std::min)(Bminx, x);
    Bmaxy = (std::max)(Bmaxy, y);
    Bminy = (std::min)(Bminy, y);
  }

  double Cmaxx = Amaxx + Bmaxx;
  double Cminx = Aminx + Bminx;
  double Cmaxy = Amaxy + Bmaxy;
  double Cminy = Aminy + Bminy;

  double maxxAbs = (std::max)(Cmaxx, std::fabs(Cminx));
  double maxyAbs = (std::max)(Cmaxy, std::fabs(Cminy));

  double maxda = (std::max)(maxxAbs, maxyAbs);
  int maxi = std::numeric_limits<int>::max();

  if (maxda < 1) {
    maxda = 1;
  }

  inputscale = (0.1f * (double)(maxi)) / maxda;

  len = A->Length();

  for (unsigned int i = 0; i < len; i++) {
    Local<Object> obj = GetObjectAt(A, i);
    int x = (int)(inputscale * GetNumberProp(obj, keyX));
    int y = (int)(inputscale * GetNumberProp(obj, keyY));
    pts.push_back(point(x, y));
  }

  sanitize_ring(pts);
  if (!valid_ring(pts)) {
    info.GetReturnValue().Set(Array::New(isolate));
    return;
  }

  polygon poly;
  boost::polygon::set_points(poly, pts.begin(), pts.end());
  a += poly;

  Local<Array> holes = GetArrayProp(A.As<Object>(), keyChildren);
  len = holes->Length();

  for (unsigned int i = 0; i < len; i++) {
    Local<Array> hole = GetArrayAt(holes, i);
    pts.clear();
    unsigned int hlen = hole->Length();
    for (unsigned int j = 0; j < hlen; j++) {
      Local<Object> obj = GetObjectAt(hole, j);
      int x = (int)(inputscale * GetNumberProp(obj, keyX));
      int y = (int)(inputscale * GetNumberProp(obj, keyY));
      pts.push_back(point(x, y));
    }
    sanitize_ring(pts);
    if (!valid_ring(pts)) {
      continue;
    }
    boost::polygon::set_points(poly, pts.begin(), pts.end());
    a -= poly;
  }

  pts.clear();
  len = B->Length();

  double xshift = 0;
  double yshift = 0;

  for (unsigned int i = 0; i < len; i++) {
    Local<Object> obj = GetObjectAt(B, i);
    double xValue = GetNumberProp(obj, keyX);
    double yValue = GetNumberProp(obj, keyY);
    int x = -(int)(inputscale * xValue);
    int y = -(int)(inputscale * yValue);
    pts.push_back(point(x, y));

    if (i == 0) {
      xshift = xValue;
      yshift = yValue;
    }
  }

  sanitize_ring(pts);
  if (!valid_ring(pts)) {
    info.GetReturnValue().Set(Array::New(isolate));
    return;
  }

  boost::polygon::set_points(poly, pts.begin(), pts.end());
  b += poly;

  polys.clear();

  convolve_two_polygon_sets(c, a, b);
  c.get(polys);

  Local<Array> result_list = Array::New(isolate);

  for (unsigned int i = 0; i < polys.size(); ++i) {
    Local<Array> pointlist = Array::New(isolate);
    int j = 0;

    for (polygon_traits<polygon>::iterator_type itr = polys[i].begin(); itr != polys[i].end(); ++itr) {
      Local<Object> p = Object::New(isolate);
      Nan::Set(p, keyX, v8::Number::New(isolate, ((double)(*itr).get(boost::polygon::HORIZONTAL)) / inputscale + xshift));
      Nan::Set(p, keyY, v8::Number::New(isolate, ((double)(*itr).get(boost::polygon::VERTICAL)) / inputscale + yshift));

      Nan::Set(pointlist, j, p);
      j++;
    }

    Local<Array> children = Array::New(isolate);
    int k = 0;
    for (polygon_with_holes_traits<polygon>::iterator_holes_type itrh = begin_holes(polys[i]); itrh != end_holes(polys[i]); ++itrh) {
      Local<Array> child = Array::New(isolate);
      int z = 0;
      for (polygon_traits<polygon>::iterator_type itr2 = (*itrh).begin(); itr2 != (*itrh).end(); ++itr2) {
        Local<Object> c = Object::New(isolate);
        Nan::Set(c, keyX, v8::Number::New(isolate, ((double)(*itr2).get(boost::polygon::HORIZONTAL)) / inputscale + xshift));
        Nan::Set(c, keyY, v8::Number::New(isolate, ((double)(*itr2).get(boost::polygon::VERTICAL)) / inputscale + yshift));

        Nan::Set(child, z, c);
        z++;
      }
      Nan::Set(children, k, child);
      k++;
    }

    Nan::Set(pointlist, keyChildren, children);

    Nan::Set(result_list, i, pointlist);
  }

  info.GetReturnValue().Set(result_list);
}
