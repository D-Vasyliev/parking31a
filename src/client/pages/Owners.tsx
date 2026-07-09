import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api";
import type { OwnerListItem } from "../../shared/api";

export function Owners() {
  const [list, setList] = useState<OwnerListItem[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiGet<OwnerListItem[]>("/api/owners").then((r) => {
      if (r.ok && r.data) setList(r.data);
    });
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((o) => o.fullName.toLowerCase().includes(s) || (o.phone ?? "").includes(s));
  }, [list, q]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Власники</h1>
        <input className="map-search" placeholder="Пошук за ПІП або телефоном…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ПІП</th>
              <th>Телефон</th>
              <th>Місця</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/owners/${o.id}`}>{o.fullName}</Link>
                </td>
                <td>{o.phone ? <a href={`tel:${o.phone}`}>{o.phone}</a> : "—"}</td>
                <td className="chips">
                  {o.spots.map((n) => (
                    <Link key={n} className="spot-chip" to={`/spots/${n}`}>
                      №{n}
                    </Link>
                  ))}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty">
                  {list.length === 0 ? "Власників ще немає — заповнюйте картки на мапі." : "Нічого не знайдено."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
