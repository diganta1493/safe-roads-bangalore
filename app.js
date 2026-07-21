/**
 * RoadWatch Bangalore — app.js
 *
 * Features:
 *  1.  Reverse geocoding
 *  2.  Severity level
 *  3.  Status tracking
 *  6.  Delete a report
 *  8.  Export to CSV
 *  11. Dark mode
 *  12. Statistics dashboard
 *  13. Animated marker drop
 *  15. Improved mobile UX — bottom sheet with drag handle + backdrop
 *  16. Firebase/Firestore backend — real-time shared data
 *  17. User geolocation
 *  Search bar — Places Autocomplete + lat,lng parsing
 *  Enhancements:
 *   A. Sort reports (newest / most confirmed / highest severity)
 *   B. Copy coordinates button in detail modal
 *   C. Deep-link share via ?report=ID
 *   D. Resolved pins rendered at 40% opacity
 *   E. Relative age badge ("3 days ago") in report list
 *   F. MarkerClusterer — groups nearby pins when zoomed out
 *   G. Top locality summary chip in stats bar
 *   H. Nearby duplicate warning on map click
 */

'use strict';

/* ─── Constants ─── */
const BANGALORE   = { lat: 12.9716, lng: 77.5946 };
const STORAGE_KEY = 'roadwatch_reports';
const THEME_KEY   = 'roadwatch_theme';
const FS_COLLECTION = 'reports';

const ISSUE_ICONS = {
  'Pothole':                    '🕳️',
  'Broken Road':                '🚧',
  'Open Manhole':               '⚠️',
  'Unpaved Road':               '🪨',
  'Open Pit (BESCOM)':          '⚡',
  'Open Pit (BWSSB)':           '💧',
  'Open Pit (ISP)':             '🌐',
  'Garbage Dump':               '🗑️',
  'Illegal Parking':            '🚗',
  'Broken Footpath':            '🦶',
  'Broken Culvert':             '🌉',
  'Clogged Storm Water Drain':  '🌧️',
  'Footpath Encroachment':      '🚷',
  'Hanging Wires':              '⚡',
};
const ISSUE_COLORS = {
  'Pothole':                    '#d97706',
  'Broken Road':                '#dc2626',
  'Open Manhole':               '#9d174d',
  'Unpaved Road':               '#065f46',
  'Open Pit (BESCOM)':          '#b45309',
  'Open Pit (BWSSB)':           '#0369a1',
  'Open Pit (ISP)':             '#6d28d9',
  'Garbage Dump':               '#4d7c0f',
  'Illegal Parking':            '#0f766e',
  'Broken Footpath':            '#7c3aed',
  'Broken Culvert':             '#0e7490',
  'Clogged Storm Water Drain':  '#1d4ed8',
  'Footpath Encroachment':      '#b91c1c',
  'Hanging Wires':              '#ca8a04',
};
const TYPE_CHIP_CLASS = {
  'Pothole':                    'chip-pothole',
  'Broken Road':                'chip-broken-road',
  'Open Manhole':               'chip-open-manhole',
  'Unpaved Road':               'chip-unpaved-road',
  'Open Pit (BESCOM)':          'chip-bescom',
  'Open Pit (BWSSB)':           'chip-bwssb',
  'Open Pit (ISP)':             'chip-isp',
  'Garbage Dump':               'chip-garbage',
  'Illegal Parking':            'chip-parking',
  'Broken Footpath':            'chip-broken-footpath',
  'Broken Culvert':             'chip-broken-culvert',
  'Clogged Storm Water Drain':  'chip-clogged-drain',
  'Footpath Encroachment':      'chip-footpath-encroachment',
  'Hanging Wires':              'chip-hanging-wires',
};
const STATUS_CHIP_CLASS = {
  'Open':        'status-open',
  'In Progress': 'status-in-progress',
  'Resolved':    'status-resolved',
};
const SEV_CLASS = {
  'Low':    'sev-low',
  'Medium': 'sev-medium',
  'High':   'sev-high',
};

/* ─── Session ID (prevents double-upvote within same browser session) ─── */
const SESSION_ID = (() => {
  let sid = sessionStorage.getItem('rw_session');
  if (!sid) { sid = 'sess_' + Math.random().toString(36).slice(2); sessionStorage.setItem('rw_session', sid); }
  return sid;
})();

/* ─── State ─── */
let map;
let pendingLatLng    = null;
let pendingAddress   = null;
let reports          = [];
let markerMap        = {};
let db               = null;   // Firestore instance (null when disabled)
let fsUnsubscribe    = null;   // Firestore real-time listener handle
let trafficLayer     = null;   // Google Maps TrafficLayer instance
let clusterer        = null;   // MarkerClusterer instance

/* ─── DOM refs ─── */
const $ = id => document.getElementById(id);
const reportModal      = $('report-modal');
const detailModal      = $('detail-modal');
const reportForm       = $('report-form');
const issueTypeEl      = $('issue-type');
const descriptionEl    = $('description');
const imageInputEl     = $('image-input');
const imagePreviewEl   = $('image-preview');
const imagePreviewWrap = $('image-preview-wrap');
const locationDisplay  = $('location-display');
const charCountEl      = $('char-count');
const reportListEl     = $('report-list');
const sidePanel        = $('side-panel');
const filterTypeEl     = $('filter-type');
const filterStatusEl   = $('filter-status');
const sortOrderEl      = $('sort-order');
const reportCountBadge = $('report-count-badge');
const mapHint          = $('map-hint');
const sheetBackdrop    = $('sheet-backdrop');

/* ═══════════════════════════════════════════════
   16. Firebase / Firestore Initialisation
═══════════════════════════════════════════════ */
function initFirebase() {
  if (!window.__FIREBASE_ENABLED__) return false;
  try {
    firebase.initializeApp(window.__FIREBASE_CONFIG__);
    db = firebase.firestore();
    console.info('[RoadWatch] Firebase connected ✓');
    return true;
  } catch (err) {
    console.error('[RoadWatch] Firebase init failed:', err);
    return false;
  }
}

/* Subscribe to real-time Firestore updates.
   Replaces the full reports array and re-renders everything. */
function subscribeFirestore() {
  if (!db) return;
  fsUnsubscribe = db.collection(FS_COLLECTION)
    .orderBy('timestamp', 'desc')
    .onSnapshot(snapshot => {
      /* Clear existing markers and clusterer */
      if (clusterer) { clusterer.clearMarkers(); clusterer = null; }
      Object.keys(markerMap).forEach(id => removeMarker(id));
      markerMap = {};

      reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      /* Cache locally for offline resilience */
      saveReportsLocal();

      renderAllMarkers();
      renderReportList();
      updateBadge();
      updateStats();
      /* C. Deep-link — open report on first snapshot */
      if (window.__DEEP_LINK_REPORT__) {
        const id = window.__DEEP_LINK_REPORT__;
        window.__DEEP_LINK_REPORT__ = null; // only once
        setTimeout(() => showDetail(id), 300);
      }
    }, err => {
      console.error('[RoadWatch] Firestore snapshot error:', err);
      showToast('⚠️ Live sync error — showing cached data');
    });
}

/* Save a report to Firestore (returns Promise) */
async function saveReportRemote(report) {
  if (!db) return;
  const { id, ...data } = report;
  /* Strip imageData from Firestore — store it only locally to avoid 1 MB doc limit */
  await db.collection(FS_COLLECTION).doc(id).set({ ...data, imageData: null });
}

/* Delete a report from Firestore */
async function deleteReportRemote(id) {
  if (!db) return;
  await db.collection(FS_COLLECTION).doc(id).delete();
}

/* Update status field in Firestore */
async function updateStatusRemote(id, newStatus) {
  if (!db) return;
  await db.collection(FS_COLLECTION).doc(id).update({ status: newStatus });
}

/* ─── 10. Upvote — Firestore atomic increment ─── */
async function upvoteReportRemote(id) {
  if (!db) return;
  await db.collection(FS_COLLECTION).doc(id).update({
    upvotes:   firebase.firestore.FieldValue.increment(1),
    upvotedBy: firebase.firestore.FieldValue.arrayUnion(SESSION_ID),
  });
}

/* ─── 10. Upvote — local-only ─── */
function upvoteReportLocal(id) {
  const report = reports.find(r => r.id === id);
  if (!report) return;
  report.upvotes   = (report.upvotes  || 0) + 1;
  report.upvotedBy = [...(report.upvotedBy || []), SESSION_ID];
  saveReportsLocal();
  renderReportList();
}

/* ═══════════════════════════════════════════════
   Map Initialisation  (called by Google Maps)
═══════════════════════════════════════════════ */
function initMap() {
  map = new google.maps.Map($('map'), {
    center: BANGALORE,
    zoom: 13,
    mapId: 'baba4dfa124e2b1ebb729832',
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    clickableIcons: false,
  });

  map.addListener('click', onMapClick);

  /* Search bar */
  initSearch();

  const firebaseReady = initFirebase();

  if (firebaseReady) {
    /* 16. Use Firestore as source of truth — onSnapshot drives UI */
    subscribeFirestore();
    showToast('🔥 Live sync enabled');
  } else {
    /* Offline / Firebase disabled — fall back to localStorage */
    loadReports();
    renderAllMarkers();
    renderReportList();
    updateBadge();
    updateStats();
    /* C. Deep-link — open report detail after local load */
    if (window.__DEEP_LINK_REPORT__) {
      setTimeout(() => showDetail(window.__DEEP_LINK_REPORT__), 300);
    }
  }

  /* 17. Auto-centre on user location */
  tryGeolocate(false);

  /* Live traffic layer toggle */
  trafficLayer = new google.maps.TrafficLayer({ autoRefresh: true });
  $('traffic-btn').addEventListener('click', () => {
    const btn = $('traffic-btn');
    const isOn = trafficLayer.getMap() !== null;
    if (isOn) {
      trafficLayer.setMap(null);
      btn.classList.remove('traffic-on');
      btn.setAttribute('aria-pressed', 'false');
      showToast('🚦 Traffic layer off');
    } else {
      trafficLayer.setMap(map);
      btn.classList.add('traffic-on');
      btn.setAttribute('aria-pressed', 'true');
      showToast('🚦 Live traffic enabled');
    }
  });
}

/* ─── Map click handler ─── */
function onMapClick(event) {
  pendingLatLng  = event.latLng;
  pendingAddress = null;

  /* H. Nearby duplicate warning — check within ~80 metres */
  const clickLat = pendingLatLng.lat();
  const clickLng = pendingLatLng.lng();
  const nearby = reports.find(r => {
    if ((r.status || 'Open') === 'Resolved') return false;
    const dLat = (r.lat - clickLat) * 111320;
    const dLng = (r.lng - clickLng) * 111320 * Math.cos(clickLat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng) < 80;
  });
  if (nearby) {
    showToast(`⚠️ Similar issue already reported ~${Math.round(
      Math.sqrt(
        Math.pow((nearby.lat - clickLat) * 111320, 2) +
        Math.pow((nearby.lng - clickLng) * 111320 * Math.cos(clickLat * Math.PI / 180), 2)
      )
    )}m away — consider confirming it instead`);
  }

  locationDisplay.textContent = '⏳ Fetching address…';
  openModal(reportModal);
  mapHint.classList.add('hide');

  /* 1. Reverse geocode */
  reverseGeocode(pendingLatLng, addr => {
    pendingAddress = addr;
    locationDisplay.textContent = addr;
  });
}

/* ═══════════════════════════════════════════════
   1. Reverse Geocoding
═══════════════════════════════════════════════ */
function reverseGeocode(latLng, callback) {
  const fallback = `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
  const geocoder = new google.maps.Geocoder();

  geocoder.geocode({ location: latLng }, (results, status) => {
    console.log('[RoadWatch] Geocoder status:', status, results);

    if (status !== 'OK' || !results || results.length === 0) {
      callback(fallback);
      return;
    }

    /* Prefer the most specific readable result type */
    const priority = [
      'route',
      'neighborhood',
      'sublocality_level_1',
      'sublocality',
      'locality',
      'administrative_area_level_2',
    ];

    let best = null;
    for (const type of priority) {
      best = results.find(r => r.types.includes(type));
      if (best) break;
    }
    if (!best) best = results[0];

    /* Build "Road Name, Locality, City" */
    const comps = best.address_components;
    const get   = (...types) =>
      (comps.find(c => types.some(t => c.types.includes(t))) || {}).long_name || '';

    const road     = get('route');
    const locality = get('sublocality_level_1', 'sublocality', 'neighborhood');
    const city     = get('locality');

    const parts = [road, locality, city].filter(Boolean);
    callback(parts.length > 0 ? parts.join(', ') : best.formatted_address);
  });
}

/* ═══════════════════════════════════════════════
   Search Bar — Places Autocomplete + lat,lng
═══════════════════════════════════════════════ */
function initSearch() {
  const input     = $('map-search-input');
  const clearBtn  = $('search-clear-btn');

  /* ── Places Autocomplete ── */
  const autocomplete = new google.maps.places.Autocomplete(input, {
    fields: ['geometry', 'formatted_address', 'name'],
    /* Bias results toward Bangalore */
    bounds: new google.maps.LatLngBounds(
      { lat: 12.834, lng: 77.460 },   // SW
      { lat: 13.140, lng: 77.780 }    // NE
    ),
    strictBounds: false,
  });

  /* When user picks a suggestion */
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry || !place.geometry.location) {
      /* Typed something but no place selected — try lat,lng parse */
      tryLatLngSearch(input.value.trim());
      return;
    }
    navigateTo(place.geometry.location, place.formatted_address || place.name);
    clearBtn.hidden = false;
  });

  /* Clear button */
  clearBtn.addEventListener('click', () => {
    input.value    = '';
    clearBtn.hidden = true;
    input.focus();
    removeSearchPin();
  });

  /* Show/hide clear button as user types */
  input.addEventListener('input', () => {
    clearBtn.hidden = input.value.length === 0;
  });

  /* Enter key with no autocomplete selection — try lat,lng */
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      /* Small delay: let Autocomplete fire first if a suggestion is highlighted */
      setTimeout(() => {
        const place = autocomplete.getPlace();
        if (!place || !place.geometry) {
          tryLatLngSearch(input.value.trim());
        }
      }, 100);
    }
  });

  /* Stop map clicks from propagating through the search box */
  google.maps.event.addDomListener($('map-search-wrap'), 'click', e => e.stopPropagation());
}

/* Parse "12.97, 77.59" or "12.97160,77.59460" */
function tryLatLngSearch(text) {
  /* Match: optional whitespace, number, comma/space separator, number */
  const match = text.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const ll = new google.maps.LatLng(lat, lng);
      /* Reverse geocode the pasted coordinates so the search box and toast
         show a human-readable address instead of raw numbers */
      reverseGeocode(ll, label => {
        navigateTo(ll, label);
        /* Update the search input itself with the resolved address */
        $('map-search-input').value = label;
        $('search-clear-btn').hidden = false;
      });
      return;
    }
  }
  showToast('No location found. Try a road name or "lat, lng".');
}

/* ── Search pin state ── */
let searchPin = null;

function navigateTo(latLng, label) {
  map.panTo(latLng);
  map.setZoom(16);

  /* Drop a temporary blue "you searched here" pin */
  removeSearchPin();

  const pinEl = document.createElement('div');
  pinEl.style.cssText = `
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #2563eb;
    border: 3px solid #fff;
    box-shadow: 0 0 0 3px rgba(37,99,235,.35), 0 2px 8px rgba(0,0,0,.3);
  `;

  if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
    searchPin = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: latLng,
      content: pinEl,
      title: label,
    });
  } else {
    searchPin = new google.maps.Marker({
      map,
      position: latLng,
      title: label,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#2563eb',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 3,
      },
    });
  }

  showToast(`📍 ${label}`);
}

function removeSearchPin() {
  if (!searchPin) return;
  if (searchPin.map !== undefined) searchPin.map = null;
  else if (searchPin.setMap) searchPin.setMap(null);
  searchPin = null;
}

/* ═══════════════════════════════════════════════
   Report Form Logic
═══════════════════════════════════════════════ */
reportForm.addEventListener('submit', onFormSubmit);
descriptionEl.addEventListener('input', () => {
  charCountEl.textContent = `${descriptionEl.value.length} / 300`;
});

imageInputEl.addEventListener('change', () => {
  const file = imageInputEl.files[0];
  if (!file) { imagePreviewWrap.hidden = true; return; }
  const reader = new FileReader();
  reader.onload = e => {
    imagePreviewEl.src      = e.target.result;
    imagePreviewWrap.hidden = false;
  };
  reader.readAsDataURL(file);
});

/* Severity pill selection highlight */
document.querySelectorAll('.severity-option input').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.severity-pill').forEach(p => p.classList.remove('selected'));
    if (radio.checked) radio.nextElementSibling.classList.add('selected');
  });
});

async function onFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const id        = 'rw_' + Date.now();
  const issueType = issueTypeEl.value;
  const severity  = document.querySelector('input[name="severity"]:checked').value;
  const desc      = descriptionEl.value.trim();
  const lat       = pendingLatLng.lat();
  const lng       = pendingLatLng.lng();
  const address   = pendingAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const timestamp = new Date().toISOString();
  const imageData = imageInputEl.files[0] ? imagePreviewEl.src : null;
  const status    = 'Open';
  const upvotes   = 0;
  const upvotedBy = [];

  const report = { id, issueType, severity, desc, lat, lng, address, timestamp, imageData, status, upvotes, upvotedBy };

  closeModal(reportModal);
  resetForm();

  if (db) {
    /* 16. Persist to Firestore — onSnapshot will update UI automatically */
    try {
      await saveReportRemote(report);
      /* Store imageData locally only (Firestore doc has imageData: null) */
      if (imageData) {
        const localCopy = JSON.parse(localStorage.getItem(STORAGE_KEY + '_images') || '{}');
        localCopy[id] = imageData;
        localStorage.setItem(STORAGE_KEY + '_images', JSON.stringify(localCopy));
      }
      showToast(`✅ Report submitted: ${issueType}`);
    } catch (err) {
      console.error('[RoadWatch] Save failed:', err);
      showToast('❌ Save failed — check connection');
    }
  } else {
    /* Local-only mode */
    reports.push(report);
    saveReportsLocal();
    placeMarker(report, true);
    renderReportList();
    updateBadge();
    updateStats();
    showToast(`✅ Report submitted: ${issueType}`);
  }
}

function validateForm() {
  let valid = true;
  const typeErr = $('issue-type-error');
  const sevErr  = $('severity-error');
  const descErr = $('description-error');
  [typeErr, sevErr, descErr].forEach(el => el.textContent = '');
  issueTypeEl.classList.remove('error');
  descriptionEl.classList.remove('error');

  if (!issueTypeEl.value) {
    typeErr.textContent = 'Please select an issue type.';
    issueTypeEl.classList.add('error');
    valid = false;
  }
  if (!document.querySelector('input[name="severity"]:checked')) {
    sevErr.textContent = 'Please select a severity level.';
    valid = false;
  }
  if (descriptionEl.value.trim().length < 5) {
    descErr.textContent = 'Description must be at least 5 characters.';
    descriptionEl.classList.add('error');
    valid = false;
  }
  return valid;
}

function resetForm() {
  reportForm.reset();
  charCountEl.textContent = '0 / 300';
  imagePreviewWrap.hidden = true;
  imagePreviewEl.src      = '';
  $('issue-type-error').textContent  = '';
  $('severity-error').textContent    = '';
  $('description-error').textContent = '';
  issueTypeEl.classList.remove('error');
  descriptionEl.classList.remove('error');
  document.querySelectorAll('.severity-pill').forEach(p => p.classList.remove('selected'));
  locationDisplay.textContent = '—';
  pendingLatLng  = null;
  pendingAddress = null;
  aiSuggestBtn.hidden = true; // hide AI button until type+severity re-selected
}

/* ═══════════════════════════════════════════════
   Markers
═══════════════════════════════════════════════ */
function placeMarker(report, animate = false) {
  const position  = { lat: report.lat, lng: report.lng };
  const icon      = ISSUE_ICONS[report.issueType]  || '📍';
  const color     = ISSUE_COLORS[report.issueType] || '#2563eb';
  const resolved  = (report.status || 'Open') === 'Resolved';

  /* D. Resolved pins at 40% opacity */
  const pin = createPinElement(icon, color, animate, resolved);

  let marker;
  if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
    marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position,
      content: pin,
      title: report.issueType,
    });
    marker.addListener('click', () => showDetail(report.id));
  } else {
    marker = new google.maps.Marker({
      map,
      position,
      title: report.issueType,
      opacity: resolved ? 0.4 : 1,
      icon: {
        url: svgPinUrl(icon, color),
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 40),
      },
      animation: animate ? google.maps.Animation.DROP : null,
    });
    marker.addListener('click', () => showDetail(report.id));
  }

  markerMap[report.id] = marker;
}

/* 13. Pin element with optional drop animation */
function createPinElement(icon, color, animate = false, resolved = false) {
  const outer = document.createElement('div');
  outer.style.cssText = `
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    opacity: ${resolved ? '0.4' : '1'};
    ${animate ? 'animation: markerDrop 0.45s cubic-bezier(.17,.67,.35,1.2) both;' : ''}
  `;
  const bubble = document.createElement('div');
  bubble.style.cssText = `
    background: ${color};
    color: #fff;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
    border: 2px solid #fff;
    font-size: 18px;
  `;
  const inner = document.createElement('span');
  inner.style.cssText = 'transform: rotate(45deg); display:block; line-height:1;';
  inner.textContent   = icon;
  bubble.appendChild(inner);
  outer.appendChild(bubble);
  return outer;
}

function svgPinUrl(icon, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="18" r="16" fill="${color}" stroke="#fff" stroke-width="2"/>
    <text x="20" y="24" text-anchor="middle" font-size="16">${icon}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/* F. MarkerClusterer — rebuild clusterer after placing all markers */
function renderAllMarkers() {
  reports.forEach(r => placeMarker(r, false));
  buildClusterer();
}

function buildClusterer() {
  if (typeof markerClusterer === 'undefined' || !markerClusterer.MarkerClusterer) return;
  if (clusterer) clusterer.clearMarkers();
  const markers = Object.values(markerMap);
  clusterer = new markerClusterer.MarkerClusterer({ map, markers });
}

function removeMarker(id) {
  const marker = markerMap[id];
  if (!marker) return;
  if (marker.map !== undefined) marker.map = null;
  else if (marker.setMap)       marker.setMap(null);
  delete markerMap[id];
}

/* ═══════════════════════════════════════════════
   3. Status helpers
═══════════════════════════════════════════════ */
function statusChip(status) {
  const cls = STATUS_CHIP_CLASS[status] || 'status-open';
  return `<span class="status-chip ${cls}">${status || 'Open'}</span>`;
}

/* ═══════════════════════════════════════════════
   Detail Modal
═══════════════════════════════════════════════ */
function showDetail(id) {
  const report = reports.find(r => r.id === id);
  if (!report) return;

  const dateStr = formatDate(report.timestamp);
  const chip    = `<span class="type-chip ${TYPE_CHIP_CLASS[report.issueType] || ''}">${report.issueType}</span>`;
  const sevCls  = SEV_CLASS[report.severity] || '';
  const sevHtml = report.severity
    ? `<span class="severity-pill ${sevCls}" style="font-size:12px">${report.severity}</span>`
    : '';

  /* Restore local imageData if Firestore stripped it */
  let imageData = report.imageData;
  if (!imageData && db) {
    const localImages = JSON.parse(localStorage.getItem(STORAGE_KEY + '_images') || '{}');
    imageData = localImages[id] || null;
  }

  let imgHtml = '';
  if (imageData) {
    imgHtml = `<img class="detail-image" src="${imageData}" alt="Issue photo" />`;
  }

  $('detail-content').innerHTML = `
    ${imgHtml}
    <div class="detail-row">
      <span class="detail-label">Issue Type</span>
      <span class="detail-value">${chip}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Severity</span>
      <span class="detail-value">${sevHtml || '—'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value status-select-wrap">
        ${statusChip(report.status)}
        <select class="status-select input-field" data-id="${report.id}" aria-label="Change status">
          <option value="Open"        ${report.status === 'Open'        ? 'selected' : ''}>Open</option>
          <option value="In Progress" ${report.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="Resolved"    ${report.status === 'Resolved'    ? 'selected' : ''}>Resolved</option>
        </select>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Description</span>
      <span class="detail-value">${escapeHtml(report.desc)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Location</span>
      <span class="detail-value">
        ${escapeHtml(report.address || `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`)}
        <button class="btn-copy-coords" title="Copy coordinates" data-lat="${report.lat}" data-lng="${report.lng}" aria-label="Copy coordinates">📋</button>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Reported On</span>
      <span class="detail-value">${dateStr}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Confirmations</span>
      <span class="detail-value upvote-display" id="upvote-display-${report.id}">
        <span class="upvote-count">${report.upvotes || 0}</span>
        <span class="upvote-label">${(report.upvotes || 0) === 1 ? 'person confirmed' : 'people confirmed'} this issue</span>
      </span>
    </div>
    ${db ? '<div class="detail-row"><span class="detail-label">Sync</span><span class="detail-value sync-badge">🔥 Live</span></div>' : ''}
  `;

  /* B. Copy coordinates */
  $('detail-content').querySelector('.btn-copy-coords')?.addEventListener('click', function () {
    navigator.clipboard.writeText(`${this.dataset.lat}, ${this.dataset.lng}`)
      .then(() => showToast('📋 Coordinates copied!'))
      .catch(() => showToast('❌ Copy failed'));
  });

  /* C. Deep-link: update URL without navigation */
  history.replaceState(null, '', `?report=${report.id}`);

  /* 3. Status change handler */
  const sel = $('detail-content').querySelector('.status-select');
  sel.addEventListener('change', async () => {
    const newStatus = sel.value;
    if (db) {
      try {
        await updateStatusRemote(id, newStatus);
        /* onSnapshot will update the list; update the chip in modal immediately */
        const wrap = sel.closest('.status-select-wrap');
        const existing = wrap.querySelector('.status-chip');
        if (existing) existing.outerHTML = statusChip(newStatus);
        showToast(`Status updated: ${newStatus}`);
      } catch (err) {
        console.error('[RoadWatch] Status update failed:', err);
        showToast('❌ Update failed');
      }
    } else {
      updateReportStatusLocal(id, newStatus);
      const wrap = sel.closest('.status-select-wrap');
      const existing = wrap.querySelector('.status-chip');
      if (existing) existing.outerHTML = statusChip(newStatus);
    }
  });

  /* 10. Upvote button */
  const hasVoted = (report.upvotedBy || []).includes(SESSION_ID);
  $('detail-actions').innerHTML = `
    <button class="btn btn-upvote ${hasVoted ? 'voted' : ''}" id="upvote-btn"
      aria-label="Confirm this issue" ${hasVoted ? 'disabled' : ''}>
      <span class="upvote-btn-icon">▲</span>
      <span id="upvote-btn-label">${hasVoted ? 'Confirmed' : 'Confirm Issue'}</span>
      <span class="upvote-btn-count" id="upvote-btn-count">${report.upvotes || 0}</span>
    </button>
    <button class="btn btn-danger" id="delete-report-btn">🗑 Delete</button>
  `;

  $('upvote-btn').addEventListener('click', async () => {
    const btn = $('upvote-btn');
    btn.disabled = true;
    /* Optimistic UI update */
    const newCount = (report.upvotes || 0) + 1;
    $('upvote-btn-count').textContent = newCount;
    $('upvote-btn-label').textContent = 'Confirmed';
    btn.classList.add('voted');
    const displayEl = $(`upvote-display-${report.id}`);
    if (displayEl) {
      displayEl.querySelector('.upvote-count').textContent = newCount;
      displayEl.querySelector('.upvote-label').textContent =
        newCount === 1 ? 'person confirmed this issue' : 'people confirmed this issue';
    }
    if (db) {
      try {
        await upvoteReportRemote(report.id);
        showToast('▲ Thanks for confirming!');
      } catch (err) {
        console.error('[RoadWatch] Upvote failed:', err);
        /* Revert optimistic update */
        $('upvote-btn-count').textContent = report.upvotes || 0;
        $('upvote-btn-label').textContent = 'Confirm Issue';
        btn.classList.remove('voted');
        btn.disabled = false;
        showToast('❌ Could not confirm — try again');
      }
    } else {
      upvoteReportLocal(report.id);
      showToast('▲ Thanks for confirming!');
    }
  });

  /* 6. Delete button */
  $('delete-report-btn').addEventListener('click', async () => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    closeModal(detailModal);
    if (db) {
      try {
        await deleteReportRemote(id);
        /* Also remove local image cache */
        const localImages = JSON.parse(localStorage.getItem(STORAGE_KEY + '_images') || '{}');
        delete localImages[id];
        localStorage.setItem(STORAGE_KEY + '_images', JSON.stringify(localImages));
        showToast('🗑 Report deleted');
      } catch (err) {
        console.error('[RoadWatch] Delete failed:', err);
        showToast('❌ Delete failed');
      }
    } else {
      deleteReportLocal(id);
      showToast('🗑 Report deleted');
    }
  });

  openModal(detailModal);
  map.panTo({ lat: report.lat, lng: report.lng });
}

/* C. Deep-link: clear URL when detail modal is closed */
$('close-detail-btn').addEventListener('click', () => history.replaceState(null, '', location.pathname), true);

/* ─── Local-only status update ─── */
function updateReportStatusLocal(id, newStatus) {
  const report = reports.find(r => r.id === id);
  if (!report) return;
  report.status = newStatus;
  saveReportsLocal();
  renderReportList();
  showToast(`Status updated: ${newStatus}`);
}

/* ─── Local-only delete ─── */
function deleteReportLocal(id) {
  reports = reports.filter(r => r.id !== id);
  removeMarker(id);
  saveReportsLocal();
  renderReportList();
  updateBadge();
  updateStats();
}

/* ═══════════════════════════════════════════════
   15. Bottom Sheet / Side Panel
═══════════════════════════════════════════════ */
$('toggle-panel-btn').addEventListener('click', () => openPanel());
$('close-panel-btn').addEventListener('click', () => closePanel());
sheetBackdrop.addEventListener('click', () => closePanel());

function openPanel() {
  sidePanel.classList.add('open');
  sheetBackdrop.classList.add('visible');
  document.body.classList.add('panel-open');
}

function closePanel() {
  sidePanel.classList.remove('open');
  sheetBackdrop.classList.remove('visible');
  document.body.classList.remove('panel-open');
}

/* ── Touch drag on bottom sheet handle (mobile) ── */
(function initSheetDrag() {
  const handle   = $('sheet-handle-wrap');
  let startY     = 0;
  let startOpen  = false;
  let dragging   = false;

  function onTouchStart(e) {
    startY    = e.touches[0].clientY;
    startOpen = sidePanel.classList.contains('open');
    dragging  = true;
    sidePanel.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    /* Only allow dragging down-to-close or up-to-open */
    if (startOpen && dy > 0) {
      /* Dragging down — sheet follows finger */
      const pct = Math.min(dy / (window.innerHeight * 0.65), 1);
      sidePanel.style.transform = `translateY(${dy}px)`;
      sheetBackdrop.style.opacity = String(1 - pct * 0.9);
    } else if (!startOpen && dy < 0) {
      /* Dragging up — sheet rises */
      const maxRise = window.innerHeight * 0.65;
      const rise = Math.min(-dy, maxRise);
      sidePanel.style.transform = `translateY(calc(100% - ${rise}px))`;
      sheetBackdrop.style.opacity = String((rise / maxRise) * 0.5);
    }
  }

  function onTouchEnd(e) {
    if (!dragging) return;
    dragging = false;
    sidePanel.style.transition = '';
    sidePanel.style.transform  = '';
    sheetBackdrop.style.opacity = '';

    const dy = e.changedTouches[0].clientY - startY;
    /* Threshold: 80px drag triggers open/close */
    if (startOpen  && dy >  80) closePanel();
    else if (startOpen)         openPanel();   // snap back
    if (!startOpen && dy < -80) openPanel();
    else if (!startOpen)        closePanel();  // snap back
  }

  handle.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove',  onTouchMove,  { passive: true });
  document.addEventListener('touchend',   onTouchEnd);
})();

filterTypeEl.addEventListener('change', renderReportList);
filterStatusEl.addEventListener('change', renderReportList);
sortOrderEl.addEventListener('change', renderReportList);

/* A. Severity sort weight */
const SEV_WEIGHT = { 'High': 3, 'Medium': 2, 'Low': 1 };

function renderReportList() {
  const fType   = filterTypeEl.value;
  const fStatus = filterStatusEl.value;
  const fSort   = sortOrderEl.value;

  let filtered = [...reports];
  if (fType)   filtered = filtered.filter(r => r.issueType === fType);
  if (fStatus) filtered = filtered.filter(r => (r.status || 'Open') === fStatus);

  /* A. Sort */
  if (fSort === 'upvotes') {
    filtered.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
  } else if (fSort === 'severity') {
    filtered.sort((a, b) => (SEV_WEIGHT[b.severity] || 0) - (SEV_WEIGHT[a.severity] || 0));
  } else {
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  if (filtered.length === 0) {
    reportListEl.innerHTML = `
      <li class="empty-state">
        <span class="empty-icon">🗺️</span>
        No reports found.<br/>Click on the map to add one.
      </li>`;
    return;
  }

  reportListEl.innerHTML = filtered.map(r => {
    const sevCls   = SEV_CLASS[r.severity] || '';
    const sevBadge = r.severity
      ? `<span class="severity-pill ${sevCls}" style="font-size:11px;padding:2px 7px">${r.severity}</span>`
      : '';
    const votes = r.upvotes || 0;
    const voteBadge = votes > 0
      ? `<span class="upvote-badge" title="${votes} confirmation${votes !== 1 ? 's' : ''}">▲ ${votes}</span>`
      : '';
    /* E. Relative age badge */
    const ageBadge = `<span class="age-badge">${timeAgo(r.timestamp)}</span>`;
    return `
    <li class="report-item" data-id="${r.id}">
      <div class="report-item-type">
        ${ISSUE_ICONS[r.issueType] || '📍'}
        <span class="type-chip ${TYPE_CHIP_CLASS[r.issueType] || ''}">${r.issueType}</span>
        ${sevBadge}
        ${statusChip(r.status || 'Open')}
        ${voteBadge}
      </div>
      <div class="report-item-desc">${escapeHtml(r.desc)}</div>
      <div class="report-item-date">${ageBadge} · 🕐 ${formatDate(r.timestamp)}</div>
    </li>`;
  }).join('');

  reportListEl.querySelectorAll('.report-item').forEach(li => {
    li.addEventListener('click', () => {
      showDetail(li.dataset.id);
      if (window.innerWidth <= 640) closePanel();
    });
  });
}

function updateBadge() {
  reportCountBadge.textContent =
    reports.length === 1 ? '1 Report' : `${reports.length} Reports`;
}

/* ═══════════════════════════════════════════════
   12. Statistics Dashboard
═══════════════════════════════════════════════ */
function updateStats() {
  const counts = {
    'Pothole': 0, 'Broken Road': 0, 'Open Manhole': 0, 'Unpaved Road': 0,
    'Open Pit (BESCOM)': 0, 'Open Pit (BWSSB)': 0, 'Open Pit (ISP)': 0,
    'Garbage Dump': 0, 'Illegal Parking': 0,
    'Broken Footpath': 0, 'Broken Culvert': 0,
    'Clogged Storm Water Drain': 0, 'Footpath Encroachment': 0,
    'Hanging Wires': 0,
  };
  reports.forEach(r => { if (counts[r.issueType] !== undefined) counts[r.issueType]++; });
  $('stat-count-pothole').textContent          = counts['Pothole'];
  $('stat-count-broken-road').textContent      = counts['Broken Road'];
  $('stat-count-open-manhole').textContent     = counts['Open Manhole'];
  $('stat-count-unpaved-road').textContent     = counts['Unpaved Road'];
  $('stat-count-bescom').textContent           = counts['Open Pit (BESCOM)'];
  $('stat-count-bwssb').textContent            = counts['Open Pit (BWSSB)'];
  $('stat-count-isp').textContent              = counts['Open Pit (ISP)'];
  $('stat-count-garbage').textContent          = counts['Garbage Dump'];
  $('stat-count-parking').textContent          = counts['Illegal Parking'];
  $('stat-count-broken-footpath').textContent  = counts['Broken Footpath'];
  $('stat-count-broken-culvert').textContent   = counts['Broken Culvert'];
  $('stat-count-clogged-drain').textContent    = counts['Clogged Storm Water Drain'];
  $('stat-count-footpath-enc').textContent     = counts['Footpath Encroachment'];
  $('stat-count-hanging-wires').textContent    = counts['Hanging Wires'];
  $('stat-count-total').textContent            = reports.length;

  /* G. Top locality chip */
  updateTopLocality();
}

function updateTopLocality() {
  const el = $('stat-top-locality');
  if (!el) return;
  const open = reports.filter(r => (r.status || 'Open') !== 'Resolved');
  if (open.length === 0) { el.textContent = '—'; return; }
  /* Extract first segment of address as locality proxy */
  const localityCounts = {};
  open.forEach(r => {
    if (!r.address) return;
    const parts = r.address.split(',');
    const key = (parts[1] || parts[0] || '').trim();
    if (key) localityCounts[key] = (localityCounts[key] || 0) + 1;
  });
  const top = Object.entries(localityCounts).sort((a, b) => b[1] - a[1])[0];
  el.textContent = top ? `${top[0]} (${top[1]})` : '—';
}

/* ═══════════════════════════════════════════════
   8. Export to CSV
═══════════════════════════════════════════════ */
$('export-csv-btn').addEventListener('click', exportCSV);

function exportCSV() {
  if (reports.length === 0) { showToast('No reports to export.'); return; }
  const headers = ['ID', 'Issue Type', 'Severity', 'Status', 'Description', 'Address', 'Latitude', 'Longitude', 'Reported On'];
  const rows = reports.map(r => [
    r.id,
    r.issueType,
    r.severity  || '',
    r.status    || 'Open',
    `"${(r.desc    || '').replace(/"/g, '""')}"`,
    `"${(r.address || '').replace(/"/g, '""')}"`,
    r.lat.toFixed(6),
    r.lng.toFixed(6),
    formatDate(r.timestamp),
  ]);
  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `roadwatch-bangalore-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📥 CSV exported!');
}

/* ═══════════════════════════════════════════════
   11. Dark Mode
═══════════════════════════════════════════════ */
(function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark') setTheme('dark');
})();

$('dark-mode-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  $('dark-mode-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ═══════════════════════════════════════════════
   17. Geolocation
═══════════════════════════════════════════════ */
$('locate-btn').addEventListener('click', () => tryGeolocate(true));

function tryGeolocate(showFeedback) {
  if (!navigator.geolocation) {
    if (showFeedback) showToast('Geolocation not supported by your browser.');
    return;
  }
  if (showFeedback) showToast('📡 Locating you…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(15);
      if (showFeedback) showToast('📍 Centred on your location');
    },
    () => { if (showFeedback) showToast('Unable to get your location.'); },
    { timeout: 8000 }
  );
}

/* ═══════════════════════════════════════════════
   Persistence (local)
═══════════════════════════════════════════════ */
function saveReportsLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (e) {
    const stripped = reports.map(r => ({ ...r, imageData: null }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      reports = stripped;
      showToast('⚠️ Storage full — images removed from old reports');
    } catch (_) { /* silent */ }
  }
}

function loadReports() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    reports   = raw ? JSON.parse(raw) : [];
  } catch (_) {
    reports = [];
  }
}

/* ═══════════════════════════════════════════════
   Modal Helpers
═══════════════════════════════════════════════ */
function openModal(modal) {
  modal.classList.add('active');
  const first = modal.querySelector('button, select, textarea, input');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal(modal) {
  modal.classList.remove('active');
}

[reportModal, detailModal].forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(reportModal);
    closeModal(detailModal);
    if (e.target === reportModal) resetForm();
  }
});

$('close-modal-btn').addEventListener('click', () => { closeModal(reportModal); resetForm(); });
$('cancel-btn').addEventListener('click',      () => { closeModal(reportModal); resetForm(); });
$('close-detail-btn').addEventListener('click',() => closeModal(detailModal));

/* ═══════════════════════════════════════════════
   Toast
═══════════════════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ═══════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════ */
/* E. Relative age — "just now", "5 min ago", "3 days ago" etc. */
function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60)                    return 'just now';
  if (sec < 3600)                  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)                 return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 30)            return `${Math.floor(sec / 86400)}d ago`;
  if (sec < 86400 * 365)           return `${Math.floor(sec / (86400 * 30))}mo ago`;
  return `${Math.floor(sec / (86400 * 365))}y ago`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/* ═══════════════════════════════════════════════
   Graceful fallback if Maps API fails to load
═══════════════════════════════════════════════ */
window.gm_authFailure = function () {
  document.getElementById('map').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;
      flex-direction:column;gap:12px;padding:24px;text-align:center;background:#fff;">
      <span style="font-size:48px">🗺️</span>
      <h2 style="font-size:18px;font-weight:700;color:#1a1d23">Google Maps API Key Required</h2>
      <p style="font-size:14px;color:#6b7280;max-width:360px">
        Open <code>index.html</code> and replace <code>YOUR_API_KEY</code>
        with a valid Google Maps JavaScript API key to load the map.
      </p>
      <a href="https://developers.google.com/maps/documentation/javascript/get-api-key"
         target="_blank" rel="noopener"
         style="font-size:13px;color:#2563eb;">How to get an API key →</a>
    </div>`;
};
