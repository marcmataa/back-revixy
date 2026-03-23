const SUPPORTED_LANGUAGES = ["es", "en", "ca"];
const DEFAULT_LANGUAGE = "es";

const translations = {
  es: {
    alerts: {
      roas_below_breakeven: "ROAS por debajo del punto de equilibrio",
      profit_negative: "Beneficio neto negativo",
      revenue_drop: "Caída de ingresos frente a la media semanal",
      ctr_declining: "CTR en descenso",
      cpc_spike: "Pico de CPC detectado",
      scale_opportunity: "Oportunidad de escalar",
      high_margin_day: "Racha de margen alto",
      roas_declining: "ROAS en tendencia bajista",
      default: "Alerta crítica de rendimiento",
    },
    email: {
      critical_alert: "Alerta Crítica",
      store: "Tienda",
      affected_metric: "Métrica afectada",
      current_value: "Valor actual",
      average_value: "Promedio de 7 días",
      open_dashboard: "Abrir Dashboard",
    },
    messages: {
      roas_below_breakeven: (roas, breakEven, days) =>
        `El ROAS es ${roas} frente al punto de equilibrio ${breakEven} durante ${days} días.`,
      profit_negative: (profitFormatted, days) =>
        `El beneficio neto es ${profitFormatted} y se mantiene en negativo durante ${days} días.`,
      revenue_drop: (revenueFormatted, averageFormatted, days) =>
        `Los ingresos ${revenueFormatted} están más de un 15% por debajo de la media semanal ${averageFormatted} durante ${days} días.`,
      ctr_declining: (ctr, average) =>
        `El CTR ${ctr} cayó más de un 20% frente al promedio de 7 días ${average}.`,
      cpc_spike: (cpc, average) =>
        `El CPC ${cpc} está más de un 20% por encima de la media semanal ${average}.`,
      scale_opportunity: (roas, breakEven, adSpendFormatted, averageFormatted) =>
        `El ROAS ${roas} supera claramente el punto de equilibrio ${breakEven}, mientras el gasto publicitario ${adSpendFormatted} sigue por debajo de la media ${averageFormatted}.`,
      high_margin_day: (margin, days) =>
        `El margen de contribución ${margin} se mantiene por encima del umbral durante ${days} días.`,
      roas_declining: (change, days) =>
        `El ROAS muestra una tendencia a la baja (${change}) en los últimos ${days} días.`,
      generic: (message) => `${message}`,
    },
  },
  en: {
    alerts: {
      roas_below_breakeven: "ROAS below break-even threshold",
      profit_negative: "Net profit is negative",
      revenue_drop: "Revenue dropped vs weekly baseline",
      ctr_declining: "CTR is declining",
      cpc_spike: "CPC spike detected",
      scale_opportunity: "Scale opportunity detected",
      high_margin_day: "High margin streak",
      roas_declining: "ROAS trending down",
      default: "Critical performance alert",
    },
    email: {
      critical_alert: "Critical Alert",
      store: "Store",
      affected_metric: "Affected metric",
      current_value: "Current value",
      average_value: "7-day average",
      open_dashboard: "Open Dashboard",
    },
    messages: {
      roas_below_breakeven: (roas, breakEven, days) =>
        `ROAS is ${roas} versus break-even ${breakEven} for ${days} days.`,
      profit_negative: (profitFormatted, days) =>
        `Net profit is ${profitFormatted} and has stayed negative for ${days} days.`,
      revenue_drop: (revenueFormatted, averageFormatted, days) =>
        `Revenue ${revenueFormatted} is more than 15% below the weekly average ${averageFormatted} for ${days} days.`,
      ctr_declining: (ctr, average) =>
        `CTR ${ctr} dropped more than 20% versus the 7-day average ${average}.`,
      cpc_spike: (cpc, average) =>
        `CPC ${cpc} is more than 20% above the weekly average ${average}.`,
      scale_opportunity: (roas, breakEven, adSpendFormatted, averageFormatted) =>
        `ROAS ${roas} is strong versus break-even ${breakEven}, while ad spend ${adSpendFormatted} remains below average ${averageFormatted}.`,
      high_margin_day: (margin, days) =>
        `Contribution margin ${margin} has remained above threshold for ${days} days.`,
      roas_declining: (change, days) =>
        `ROAS shows a declining trend (${change}) across the last ${days} days.`,
      generic: (message) => `${message}`,
    },
  },
  ca: {
    alerts: {
      roas_below_breakeven: "ROAS per sota del punt d'equilibri",
      profit_negative: "Benefici net negatiu",
      revenue_drop: "Caiguda d'ingressos respecte la mitjana setmanal",
      ctr_declining: "CTR en descens",
      cpc_spike: "Pic de CPC detectat",
      scale_opportunity: "Oportunitat d'escalar",
      high_margin_day: "Ratxa de marge alt",
      roas_declining: "ROAS en tendència a la baixa",
      default: "Alerta crítica de rendiment",
    },
    email: {
      critical_alert: "Alerta Crítica",
      store: "Botiga",
      affected_metric: "Mètrica afectada",
      current_value: "Valor actual",
      average_value: "Mitjana de 7 dies",
      open_dashboard: "Obrir Dashboard",
    },
    messages: {
      roas_below_breakeven: (roas, breakEven, days) =>
        `El ROAS és ${roas} davant del punt d'equilibri ${breakEven} durant ${days} dies.`,
      profit_negative: (profitFormatted, days) =>
        `El benefici net és ${profitFormatted} i es manté negatiu durant ${days} dies.`,
      revenue_drop: (revenueFormatted, averageFormatted, days) =>
        `Els ingressos ${revenueFormatted} estan més d'un 15% per sota de la mitjana setmanal ${averageFormatted} durant ${days} dies.`,
      ctr_declining: (ctr, average) =>
        `El CTR ${ctr} ha baixat més d'un 20% respecte de la mitjana de 7 dies ${average}.`,
      cpc_spike: (cpc, average) =>
        `El CPC ${cpc} és més d'un 20% superior a la mitjana setmanal ${average}.`,
      scale_opportunity: (roas, breakEven, adSpendFormatted, averageFormatted) =>
        `El ROAS ${roas} supera clarament el punt d'equilibri ${breakEven}, mentre la despesa publicitària ${adSpendFormatted} continua per sota de la mitjana ${averageFormatted}.`,
      high_margin_day: (margin, days) =>
        `El marge de contribució ${margin} es manté per sobre del llindar durant ${days} dies.`,
      roas_declining: (change, days) =>
        `El ROAS mostra una tendència a la baixa (${change}) en els darrers ${days} dies.`,
      generic: (message) => `${message}`,
    },
  },
};

const getT = (language) => {
  try {
    // Normalizamos cualquier entrada no-string para evitar errores en trim.
    const rawLanguage = typeof language === "string" ? language : "";
    // Limpiamos espacios y forzamos minúsculas para comparación consistente.
    const normalizedLanguage = rawLanguage.trim().toLowerCase();
    // Validamos contra los idiomas permitidos para bloquear valores inesperados.
    const safeLanguage = SUPPORTED_LANGUAGES.includes(normalizedLanguage)
      ? normalizedLanguage
      : DEFAULT_LANGUAGE;
    // Devolvemos traducciones seguras con fallback nullish al idioma por defecto.
    return translations[safeLanguage] ?? translations[DEFAULT_LANGUAGE];
  } catch (_error) {
    // Nunca rompemos el pipeline por errores de i18n; último recurso en español.
    return translations[DEFAULT_LANGUAGE];
  }
};

export { translations, getT };
