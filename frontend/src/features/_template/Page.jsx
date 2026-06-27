// p3portal.org
// PROJ-XX: Hauptseite des FEATURE-Moduls.
// Route: /feature (eintragen in frontend/src/App.jsx)
import { useTranslation } from 'react-i18next';
import { useFEATUREs } from './hooks/useFEATUREs';

export default function FEATUREPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useFEATUREs();

  if (isLoading) return <div className="p-6 text-portal-text">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-portal-danger">{error.message}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-portal-text mb-4">
        {t('feature.title')}
      </h1>

      <div className="bg-portal-card rounded-lg border border-portal-border p-4">
        {data?.length === 0 ? (
          <p className="text-portal-muted">{t('feature.empty')}</p>
        ) : (
          <ul>
            {data?.map(item => (
              <li key={item.id} className="py-2 border-b border-portal-border last:border-0">
                {item.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
