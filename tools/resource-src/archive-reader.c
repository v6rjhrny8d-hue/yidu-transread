/* libarchive BSD local-file adapter. C never writes archive paths. */
#include <archive.h>
#include <archive_entry.h>
#include <locale.h>
#include <emscripten/emscripten.h>
EMSCRIPTEN_KEEPALIVE struct archive *yidu_open(const char *path){setlocale(LC_CTYPE,"C.UTF-8");struct archive *a=archive_read_new();if(!a)return 0;archive_read_support_filter_none(a);archive_read_support_format_rar(a);archive_read_support_format_rar5(a);archive_read_support_format_zip(a);if(archive_read_open_filename(a,path,65536)!=ARCHIVE_OK){archive_read_free(a);return 0;}return a;}
EMSCRIPTEN_KEEPALIVE int yidu_next(struct archive *a,struct archive_entry **e){return archive_read_next_header(a,e);}
EMSCRIPTEN_KEEPALIVE int yidu_read(struct archive *a,void *p,int n){return archive_read_data(a,p,n);}
EMSCRIPTEN_KEEPALIVE const char *yidu_path(struct archive_entry *e){return archive_entry_pathname_utf8(e);}
EMSCRIPTEN_KEEPALIVE double yidu_size(struct archive_entry *e){return (double)archive_entry_size(e);}
EMSCRIPTEN_KEEPALIVE int yidu_type(struct archive_entry *e){return archive_entry_filetype(e);}
EMSCRIPTEN_KEEPALIVE int yidu_link(struct archive_entry *e){return archive_entry_symlink(e)||archive_entry_hardlink(e);}
EMSCRIPTEN_KEEPALIVE int yidu_encrypted(struct archive_entry *e){return archive_entry_is_encrypted(e);}
EMSCRIPTEN_KEEPALIVE int yidu_close(struct archive *a){return archive_read_free(a);}
