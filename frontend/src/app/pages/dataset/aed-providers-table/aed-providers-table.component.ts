import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalizeRouterPipe } from '@gilsdav/ngx-translate-router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AedProvider, AedRecord, AedService } from '@app/services/aed.service';

interface ProviderGroup extends AedProvider {
  expanded: boolean;
  loading: boolean;
  records: AedRecord[] | null;
  error: boolean;
}

/**
 * Ogólnopolski zbiór AED: dane pogrupowane według dostawców (rozwijane sekcje).
 * Przycisk „Zgłoś uwagi do dostawcy” w nagłówku każdej sekcji otwiera standardowy formularz zgłoszenia
 * z adresem zasobu źródłowego dostawcy – zgłoszenie trafia do instytucji odpowiedzialnej za dane,
 * a nie do właściciela agregatu.
 */
@Component({
  selector: 'app-aed-providers-table',
  standalone: true,
  imports: [NgFor, NgIf, DatePipe, DecimalPipe, RouterLink, LocalizeRouterPipe, TranslatePipe],
  templateUrl: './aed-providers-table.component.html',
  styleUrls: ['./aed-providers-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AedProvidersTableComponent implements OnInit {
  /** Rozwiń pierwszą sekcję po załadowaniu */
  @Input() expandFirst = false;

  private readonly aedService = inject(AedService);
  private readonly translate = inject(TranslateService);
  private readonly cdr = inject(ChangeDetectorRef);

  providers: ProviderGroup[] = [];
  loading = true;
  error = false;

  ngOnInit(): void {
    this.aedService.getProviders().subscribe({
      next: (providers) => {
        this.providers = providers.map((p) => ({ ...p, expanded: false, loading: false, records: null, error: false }));
        this.loading = false;
        if (this.expandFirst && this.providers.length) {
          this.toggle(this.providers[0]);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = true;
        this.cdr.markForCheck();
      },
    });
  }

  get totalActive(): number {
    return this.providers.reduce((sum, p) => sum + (p.aktywne || 0), 0);
  }

  toggle(group: ProviderGroup): void {
    group.expanded = !group.expanded;
    if (group.expanded && group.records === null && !group.loading) {
      group.loading = true;
      this.aedService.getProviderRecords(group.id).subscribe({
        next: (records) => {
          group.records = records;
          group.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          group.loading = false;
          group.error = true;
          this.cdr.markForCheck();
        },
      });
    }
    this.cdr.markForCheck();
  }

  expandAll(expand: boolean): void {
    this.providers.filter((p) => p.expanded !== expand).forEach((p) => this.toggle(p));
  }

  /** Adres zasobu źródłowego dostawcy – formularz zgłoszenia wyśle uwagę do tej instytucji. */
  feedbackUrl(group: ProviderGroup): string {
    const lang = this.translate.currentLang || 'pl';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const base = `${origin}/${lang}/dataset/${group.zbior_zrodlowy_id}`;
    return group.zasob_zrodlowy_id ? `${base}/resource/${group.zasob_zrodlowy_id}` : base;
  }

  address(record: AedRecord): string {
    const street = [record['ulica'], record['nr_budynku']].filter(Boolean).join(' ');
    const city = [record['kod_pocztowy'], record['miejscowosc']].filter(Boolean).join(' ');
    return [street, city].filter(Boolean).join(', ') || '—';
  }

  access(record: AedRecord): string {
    const value = record['dostep'];
    return value ? this.translate.instant(`Aed.ProvidersTable.Access.${value}`) : '—';
  }

  trackById(_: number, item: ProviderGroup): number {
    return item.id;
  }

  trackByUid(_: number, item: AedRecord): string {
    return item['aed_uid'];
  }
}
