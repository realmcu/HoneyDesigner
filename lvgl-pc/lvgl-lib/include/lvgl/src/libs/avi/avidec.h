#ifndef AVIDEC_H
#define AVIDEC_H

#ifdef __cplusplus
extern "C" {
#endif

#include "../../misc/lv_fs.h"

// #define LV_AVI_DEBUG_VIEW 1

#if LV_USE_AVI || LV_AVI_DEBUG_VIEW
#include <stdint.h>

#pragma pack(1)
typedef struct 
{
    uint32_t usec_per_frame;
    uint32_t max_byte_rate;
    uint32_t reserved_0;
    uint32_t flags;
    uint32_t total_frame;
    uint32_t initial_frame;
    uint32_t streams;
    uint32_t buffer_size;
    uint32_t width;
    uint32_t height;
}MainAVIHeader_t;

typedef struct 
{
    uint32_t type;              // "vids"
    uint32_t handler;           /* Optionally, contains a FOURCC for a specific data handler. */
    uint32_t flags;             /*  */
    uint32_t priority;          /*  */
    uint32_t initial_frames;    /*  */
    uint32_t scale;             /*  */
    uint32_t rate;              /*  */
    uint32_t start;             /*  */
    uint32_t length;            /*  */
    uint32_t buffer_size;       /* This should be larger than the largest chunk, zero if unknown. */
    uint32_t quality;           /* A value between 0 and 10,000. */
    uint32_t sample_size;       /* The size of a sample; zero if varying, block align for audio. */
    uint16_t frame[4];             /* The left, top, right, bottom coordinates in 16 bit values. */
    uint32_t stream_format;     /* The letters "strf" indicate that this is a stream format. */
    uint32_t length_format;     /* This size of the format. */
}AVIStreamHeader_t;

typedef struct 
{
    uint32_t size;              /*  */
    uint32_t width;             /*  */
    uint32_t height;            /*  */
    uint16_t planes;            /*  */
    uint16_t bit_count;         /*  */
    uint32_t compression;       /*  */
    uint32_t image_size;        /*  */
    uint32_t x_pels_per_meter;  /*  */
    uint32_t y_pels_per_meter;  /*  */
    uint32_t colors_used;       /*  */
    uint32_t colors_important;  /*  */
}BitMapInfoHeader_t;

typedef struct 
{
    uint32_t indexID;              /*  */
    uint32_t index_size;           /*  */
}IndexList_t;

typedef struct 
{
    uint32_t chunk_ID;         /*  */
    uint32_t flags;            /*  */
    uint32_t offset;           /*  */
    uint32_t size;             /*  */
}IndexItem_t;

#pragma pack()


typedef struct _ad_AVI {
    lv_fs_file_t fd;
    const char * data;
    uint8_t is_file;
    uint32_t f_rw_p;
    int32_t anim_start;
    uint32_t width;
    uint32_t height;
    int32_t loop_count;
    uint32_t cur_frame;
    uint32_t cur_frame_pos;
    uint32_t cur_frame_size;

    uint32_t frame_num;
    uint32_t frame_time;

    uint32_t file_size;
    uint32_t movi_size;
    int movi_data_beacon;
    uint32_t chunk_num;
    int idx1_data_beacon;

    uint8_t *framedata;
    uint8_t *framedata_raw;
} ad_AVI;


ad_AVI * ad_open_avi_file(const char * fname);

ad_AVI * ad_open_avi_data(const void * data);

void ad_render_frame(ad_AVI * avi);

int ad_get_frame(ad_AVI * avi);
void ad_release_frame(ad_AVI * avi);
void ad_rewind(ad_AVI * avi);
void ad_close_avi(ad_AVI * avi);

#endif /*LV_USE_AVI*/

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* AVIDEC_H */
